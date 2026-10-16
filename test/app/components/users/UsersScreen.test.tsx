/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { initial, roleTone, UsersScreen, type ApiClient } from "@/app/components/users/UsersScreen";
import type { AuditEvent } from "@/lib/door/settingsStore";
import type { UserRow } from "@/lib/door/users";

afterEach(() => {
  cleanup();
});

const ADA: UserRow = { entry: { sub: null, email: "ada@example.com" }, role: "admin", agents: [], locked: true };
const BOB: UserRow = { entry: { sub: null, email: "bob@example.com" }, role: "operator", agents: ["kit"], locked: false };

const AUDIT: AuditEvent = {
  id: 1,
  at: Date.UTC(2026, 9, 10, 16, 5),
  who: "118212345678901234567",
  action: "user.add",
  detail: JSON.stringify({ entry: "bob@example.com", role: "operator", agents: ["kit"] }),
};

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") {
    return input;
  }
  if (input instanceof URL) {
    return input.href;
  }
  return input.url;
}

function textBody(body: BodyInit | null | undefined): string {
  if (typeof body !== "string") {
    throw new Error("expected a string body");
  }
  return body;
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function clientWith(payload: { users: UserRow[]; audit: AuditEvent[] }): ApiClient {
  return vi.fn(async () => json(200, payload));
}

describe("initial", () => {
  it("takes the email's first letter, never the sub's digit", () => {
    expect(initial({ email: "sam@example.com" }, "100000000000000000002:sam@example.com")).toBe("S");
    expect(initial({ email: null }, "bob@example.com")).toBe("B");
    expect(initial({ email: null }, " ")).toBe("?");
  });
});

describe("roleTone", () => {
  it("maps each role to its colour classes", () => {
    expect(roleTone("admin")).toBe("text-ok border-ok/40 bg-ok/10");
    expect(roleTone("operator")).toBe("text-info border-info/40 bg-info/10");
    expect(roleTone("member")).toBe("text-mark border-accent-line bg-accent-soft");
  });
});

describe("UsersScreen", () => {
  it("lists locked env rows beside stored rows and the audit", async () => {
    const client = clientWith({ users: [ADA, BOB], audit: [AUDIT] });
    render(<UsersScreen client={client} />);

    const ada = await screen.findByRole("listitem", { name: "ada@example.com" });
    expect(within(ada).getByText("locked")).toBeTruthy();
    expect(within(ada).queryByRole("button", { name: "Remove ada@example.com" })).toBeNull();
    const bob = screen.getByRole("listitem", { name: "bob@example.com" });
    expect(within(bob).getByText("kit")).toBeTruthy();
    expect(within(bob).getByRole("button", { name: "Remove bob@example.com" })).toBeTruthy();
    expect(screen.getByRole("region", { name: "Audit" }).textContent).toContain("added bob@example.com operator [kit]");
    expect(screen.getByText("Users, settings, and every agent; chat only the agents on their row.")).toBeTruthy();
  });

  it("adds an operator and keeps a rejected entry in the field", async () => {
    const users = [ADA];
    const calls: { url: string; body?: string }[] = [];
    const client: ApiClient = vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const method = init?.method ?? "GET";
      calls.push({ url: requestUrl(input), body: typeof init?.body === "string" ? init.body : undefined });
      if (method === "POST") {
        const body = JSON.parse(textBody(init?.body)) as { entry: string; role: string; agents: string[] };
        if (body.entry === "bad") {
          return json(400, { error: "bad_entry" });
        }
        users.push({ entry: { sub: null, email: body.entry }, role: "operator", agents: body.agents, locked: false });
        return json(200, { user: users[users.length - 1] });
      }
      return json(200, { users: [...users], audit: [] });
    });
    render(<UsersScreen client={client} />);
    await screen.findByRole("listitem", { name: "ada@example.com" });

    const form = screen.getByRole("form", { name: "Add a user" });
    fireEvent.change(within(form).getByLabelText("Email or sub:email"), { target: { value: "bad" } });
    fireEvent.click(within(form).getByRole("button", { name: "Add user" }));
    expect((await screen.findByRole("alert")).textContent).toContain("Use an email or sub:email.");
    expect(within(form).getByLabelText<HTMLInputElement>("Email or sub:email").value).toBe("bad");

    fireEvent.change(within(form).getByLabelText("Role"), { target: { value: "operator" } });
    fireEvent.change(within(form).getByLabelText("Email or sub:email"), { target: { value: "eve@example.com" } });
    fireEvent.change(within(form).getByLabelText("Agents"), { target: { value: "Kit, ada" } });
    fireEvent.click(within(form).getByRole("button", { name: "Add user" }));

    expect(await screen.findByRole("listitem", { name: "eve@example.com" })).toBeTruthy();
    expect(screen.getByRole("status").textContent).toContain("Saved eve@example.com.");
    const posted = calls.filter((call) => call.body?.includes("eve@example.com")).pop();
    expect(JSON.parse(posted?.body ?? "{}")).toEqual({ entry: "eve@example.com", role: "operator", agents: ["kit", "ada"] });
    expect(within(form).getByLabelText<HTMLInputElement>("Email or sub:email").value).toBe("");
  });

  it("saves a role change and confirms a remove", async () => {
    let users = [ADA, BOB];
    let deleted = "";
    let lastPost = "";
    const client: ApiClient = vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const method = init?.method ?? "GET";
      if (method === "POST") {
        lastPost = textBody(init?.body);
        const body = JSON.parse(lastPost) as { entry: string; role: string; agents: string[] };
        users = users.map((user) => user.entry.email === "bob@example.com"
          ? { ...user, role: "admin" as const, agents: body.agents }
          : user);
        return json(200, { user: users[1] });
      }
      if (method === "DELETE") {
        deleted = requestUrl(input);
        users = users.filter((user) => user.entry.email !== "bob@example.com");
        return json(200, { ok: true });
      }
      return json(200, { users, audit: [] });
    });
    render(<UsersScreen client={client} />);
    await screen.findByRole("listitem", { name: "bob@example.com" });

    fireEvent.click(screen.getByRole("button", { name: "Edit bob@example.com" }));
    fireEvent.change(screen.getByLabelText("Role for bob@example.com"), { target: { value: "admin" } });
    fireEvent.change(screen.getByLabelText("Agents for bob@example.com"), { target: { value: "kit" } });
    fireEvent.click(screen.getByRole("button", { name: "Save bob@example.com" }));
    expect(await screen.findByText("Saved bob@example.com.")).toBeTruthy();
    expect(JSON.parse(lastPost)).toEqual({ entry: "bob@example.com", role: "admin", agents: ["kit"] });

    fireEvent.click(screen.getByRole("button", { name: "Remove bob@example.com" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel remove bob@example.com" }));
    expect(screen.getByRole("button", { name: "Remove bob@example.com" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Remove bob@example.com" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm remove bob@example.com" }));
    expect(await screen.findByText("Removed bob@example.com.")).toBeTruthy();
    expect(deleted).toBe("/api/users/bob%40example.com");
    await waitFor(() => {
      expect(screen.queryByRole("listitem", { name: "bob@example.com" })).toBeNull();
    });
  });

  it("hides the form from someone who is not an admin", async () => {
    const client: ApiClient = vi.fn(async () => json(403, { error: "forbidden" }));
    render(<UsersScreen client={client} />);
    expect((await screen.findByRole("alert")).textContent).toContain("Only an admin can change users.");
    expect(screen.queryByRole("form", { name: "Add a user" })).toBeNull();
  });

  it("says when the request never arrives", async () => {
    const client: ApiClient = vi.fn(async () => {
      throw new Error("offline");
    });
    render(<UsersScreen client={client} />);
    expect((await screen.findByRole("alert")).textContent).toContain("Could not reach users. Try again.");
    expect(screen.getByText("No changes yet.")).toBeTruthy();
  });

  it("shows a non-JSON failure and a raw audit detail", async () => {
    const client: ApiClient = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      if ((init?.method ?? "GET") === "GET") {
        return json(200, {
          users: [BOB],
          audit: [{ id: 4, at: Number.NaN, who: "ada", action: "user.remove", detail: "not-json" }],
        });
      }
      return new Response("nope", { status: 500 });
    });
    render(<UsersScreen client={client} />);
    const audit = await screen.findByRole("region", { name: "Audit" });
    expect(audit.textContent).toContain("removed not-json");
    fireEvent.click(screen.getByRole("button", { name: "Remove bob@example.com" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm remove bob@example.com" }));
    expect((await screen.findByRole("alert")).textContent).toContain("Could not reach users. Try again.");
  });

  it("paints the hero, role chips, avatars, and an audit timeline", async () => {
    const client = clientWith({ users: [ADA, BOB], audit: [AUDIT] });
    render(<UsersScreen client={client} />);

    expect(screen.getByRole("heading", { name: "Users" })).toBeTruthy();
    expect(screen.getByText("Who may sign in, and as what. Environment rows stay locked.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "gantree home" }).getAttribute("href")).toBe("/");
    expect(screen.getByRole("link", { name: "Agents" }).getAttribute("href")).toBe("/agents");
    expect(screen.getByRole("link", { name: "Settings" }).getAttribute("href")).toBe("/settings");

    const roles = screen.getByRole("list", { name: "Roles" });
    expect(within(roles).getByText("admin").className).toContain(roleTone("admin"));
    expect(within(roles).getByText("operator").className).toContain(roleTone("operator"));
    expect(within(roles).getByText("member").className).toContain(roleTone("member"));
    expect(roles.querySelector(".bg-ok")).toBeTruthy();
    expect(roles.querySelector(".bg-info")).toBeTruthy();
    expect(roles.querySelector(".bg-mark")).toBeTruthy();

    const ada = await screen.findByRole("listitem", { name: "ada@example.com" });
    const adaInitial = within(ada).getByText("A", { selector: "span" });
    expect(adaInitial.className).toContain("rounded-xl");
    expect(adaInitial.className).toContain("from-accent");
    expect(adaInitial.className).toContain("to-mark");
    expect(adaInitial.className).toContain("text-canvas");
    expect(adaInitial.className).toContain("font-bold");
    expect(within(ada).getByText("admin").className).toContain(roleTone("admin"));
    const locked = within(ada).getByText("locked");
    expect(locked.className).toContain("text-dim");
    expect(locked.className).toContain("border-line");
    expect(locked.querySelector("[aria-hidden]")).toBeTruthy();

    const bob = screen.getByRole("listitem", { name: "bob@example.com" });
    expect(within(bob).getByText("operator").className).toContain(roleTone("operator"));
    expect(within(bob).getByText("kit").className).toContain("text-mark");

    const form = screen.getByRole("form", { name: "Add a user" });
    expect(within(form).getByRole("heading", { name: "Add someone" })).toBeTruthy();
    expect(within(form).getByLabelText("Email or sub:email").className).toContain("rounded-xl");
    const add = within(form).getByRole("button", { name: "Add user" });
    expect(add.className).toContain("rounded-xl");
    expect(add.className).toContain("bg-accent");
    expect(add.className).toContain("text-canvas");
    expect(add.className).toContain("font-semibold");

    const audit = screen.getByRole("region", { name: "Audit" });
    const when = audit.querySelector("time");
    expect(when?.getAttribute("dateTime")).toBe("2026-10-10T16:05:00.000Z");
    expect(when?.textContent).toBe("2026-10-10 16:05");
    expect(within(audit).getByText("118212345678901234567").tagName).toBe("SPAN");
    expect(audit.querySelector("ol .rounded-full.bg-accent")).toBeTruthy();
    expect(audit.querySelector("ol .w-px.bg-line")).toBeTruthy();
  });
});
