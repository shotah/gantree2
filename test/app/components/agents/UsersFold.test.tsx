/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { UsersFold, cleanEmail } from "@/app/components/agents/UsersFold";
import type { ApiClient } from "@/app/lib/agentsHttp";
import type { RoomUser } from "@/lib/chat/allow";
import { json, inputOf, textBody } from "./fixtures";

afterEach(() => {
  cleanup();
});

const ADA: RoomUser = { email: "ada@example.com", sub: "118212345678901234567" };
const BOB: RoomUser = { sub: "118212345678901234568" };

describe("cleanEmail", () => {
  it("lowercases a full address and rejects the rest", () => {
    expect(cleanEmail(" Ada@Example.com ")).toBe("ada@example.com");
    expect(cleanEmail("nope")).toBeNull();
    expect(cleanEmail("a@b")).toBeNull();
  });
});

describe("UsersFold", () => {
  it("adds by email, removes a row, and explains chat access", async () => {
    const saved: RoomUser[][] = [];
    const client: ApiClient = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      await Promise.resolve();
      const body = JSON.parse(textBody(init?.body)) as { users: RoomUser[] };
      saved.push(body.users);
      return json(200, { users: body.users });
    });
    render(<UsersFold slug="kit" users={[ADA, BOB]} canMutate client={client} onUsers={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Who can chat" }));
    expect(screen.getByText("Members can chat with this agent only when they are on this list.")).toBeTruthy();
    expect(screen.getByText("118212345678901234567")).toBeTruthy();
    expect(screen.getByText(BOB.sub ?? "")).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "nope" } });
    fireEvent.click(screen.getByRole("button", { name: "Add email" }));
    expect(screen.getByRole("alert").textContent).toContain("Use an email address.");
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "Ada@Example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Add email" }));
    expect(screen.getByRole("alert").textContent).toContain("That email is already on the list.");
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "eve@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Add email" }));
    await vi.waitFor(() => expect(saved[0]).toEqual([ADA, BOB, { email: "eve@example.com" }]));
    expect((inputOf(screen.getByLabelText("Email"))).value).toBe("");

    fireEvent.click(screen.getByRole("button", { name: "Remove 118212345678901234568" }));
    await vi.waitFor(() => expect(saved[1]?.some((user) => user.sub === BOB.sub)).toBe(false));
  });

  it("keeps the email when the save fails and hides the form when looking only", async () => {
    const client: ApiClient = vi.fn(() => Promise.resolve(json(500, { error: "forbidden" })));
    const { rerender } = render(<UsersFold slug="kit" users={[]} canMutate client={client} onUsers={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Who can chat" }));
    expect(screen.getByText("Nobody on the list yet.")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "eve@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Add email" }));
    expect((await screen.findByRole("alert")).textContent).toContain("You do not have access to that.");
    expect((inputOf(screen.getByLabelText("Email"))).value).toBe("eve@example.com");

    rerender(<UsersFold slug="kit" users={[ADA]} canMutate={false} client={vi.fn()} onUsers={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "Add email" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Remove ada@example.com" })).toBeNull();
    expect(screen.getByText("ada@example.com")).toBeTruthy();
  });
});
