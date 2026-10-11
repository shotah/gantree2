import { describe, expect, it } from "vitest";
import { adjustDueMaxForTasksAPI } from "@/brain/plugins/google/tasks";
import { callTool, jsonResponse, liveToken, recordingFetch, testCtx, textOf } from "@/test/brain/plugins/google/harness";

const authed = (fetch: typeof globalThis.fetch) => testCtx({ token: liveToken(), fetch });

describe("tasks dueMax", () => {
  it("adds one day and keeps the offset", () => {
    expect(adjustDueMaxForTasksAPI("2026-07-28T00:00:00Z")).toBe("2026-07-29T00:00:00Z");
    expect(adjustDueMaxForTasksAPI("2026-07-28T00:00:00-07:00")).toBe("2026-07-29T00:00:00-07:00");
    expect(adjustDueMaxForTasksAPI("2026-07-28T15:04:05")).toBe("2026-07-29T15:04:05Z");
    expect(adjustDueMaxForTasksAPI("tomorrow")).toBe("tomorrow");
  });
});

describe("tasks tools", () => {
  it("requires task_list_id with the Go RequireString text", async () => {
    const result = await callTool(testCtx({ token: liveToken() }), "tasks_get_tasklist", {});
    expect(textOf(result)).toBe("required argument \"task_list_id\" not found");
  });

  it("lists task lists and tasks as a tree", async () => {
    const { fetch, hits } = recordingFetch((hit) => {
      if (hit.url.pathname.endsWith("/tasks")) {
        expect(hit.url.searchParams.get("dueMax")).toBe("2026-07-29T00:00:00Z");
        expect(hit.url.searchParams.get("showCompleted")).toBe("true");
        return jsonResponse({
          items: [
            { id: "child", title: "Sub", status: "needsAction", parent: "parent", position: "200", notes: "n" },
            { id: "parent", title: "Parent", status: "needsAction", position: "100", updated: "u1" },
            { id: "orphan", title: "Lost", parent: "missing", position: "1" },
          ],
        });
      }
      return jsonResponse({
        items: [{ id: "L1", title: "Personal", updated: "u0" }],
        nextPageToken: "N",
      });
    });
    const lists = textOf(await callTool(authed(fetch), "tasks_list_tasklists"));
    expect(lists).toContain("Task Lists for test@example.com:");
    expect(lists).toContain("- Personal (ID: L1)");
    expect(lists).toContain("\nNext page token: N");
    const tasks = textOf(await callTool(authed(fetch), "tasks_list_tasks", {
      task_list_id: "@default",
      due_max: "2026-07-28T00:00:00Z",
    }));
    expect(hits.some((hit) => hit.url.pathname.includes("%40default"))).toBe(true);
    expect(tasks.indexOf("- Parent")).toBeLessThan(tasks.indexOf("* Sub"));
    expect(tasks).toContain("Unknown parent");
    expect(tasks).toContain("1 tasks with title Unknown parent are included as placeholders.");
  });

  it("creates, updates, moves, and clears", async () => {
    const { fetch, hits } = recordingFetch((hit) => {
      if (hit.method === "GET") {
        return jsonResponse({ id: "T1", title: "Old", status: "needsAction", notes: "keep" });
      }
      if (hit.url.pathname.endsWith("/move")) {
        return jsonResponse({ id: "T1", title: "Old", status: "needsAction", parent: "P", position: "9" });
      }
      if (hit.url.pathname.endsWith("/clear")) {
        return jsonResponse({});
      }
      return jsonResponse({ id: "T1", title: "Buy milk", status: "needsAction", updated: "u", due: "2026-07-31T00:00:00Z" });
    });
    const created = textOf(await callTool(authed(fetch), "tasks_create_task", {
      task_list_id: "@default",
      title: "Buy milk",
      due: "2026-07-31T00:00:00Z",
    }));
    expect(created).toContain("Task Created for test@example.com:");
    expect(created).toContain("- Due Date: 2026-07-31T00:00:00Z");
    const updated = textOf(await callTool(authed(fetch), "tasks_update_task", {
      task_list_id: "@default",
      task_id: "T1",
      status: "completed",
    }));
    const put = hits.find((hit) => hit.method === "PUT");
    expect(JSON.parse(put?.body ?? "{}")).toEqual({ id: "T1", title: "Old", status: "completed", notes: "keep" });
    expect(updated).toContain("Task Updated for test@example.com:");
    const moved = textOf(await callTool(authed(fetch), "tasks_update_task_position", {
      task_list_id: "L1",
      task_id: "T1",
      parent: "P",
      destination_task_list: "L2",
    }));
    expect(moved).toContain("Move Details: moved to task list L2, made a subtask of P");
    const cleared = textOf(await callTool(authed(fetch), "tasks_delete_completed", { task_list_id: "L1" }));
    expect(cleared).toContain("All completed tasks have been cleared from task list L1");
  });

  it("uses needArg for list/get/create and the raw error for move", async () => {
    const ctx = testCtx({ token: liveToken() });
    expect(textOf(await callTool(ctx, "tasks_list_tasks", {}))).toContain("task_list_id is required. Next:");
    expect(textOf(await callTool(ctx, "tasks_get_task", { task_list_id: "@default" }))).toContain("task_id is required");
    expect(textOf(await callTool(ctx, "tasks_create_task", { task_list_id: "@default" }))).toContain("title is required");
    expect(textOf(await callTool(ctx, "tasks_update_task_position", {}))).toBe("required argument \"task_list_id\" not found");
  });
});
