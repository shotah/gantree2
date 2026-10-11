import type { CallContext, PluginContext, Tool, ToolResult } from "@/brain/core/tools";
import { errorResult, jsonResult, textResult } from "@/brain/core/tools";
import {
  ArgTypeError,
  arrField,
  errorText,
  getBoolOnly,
  getInt,
  getString,
  hasKey,
  isRecord,
  needArg,
  requireArgString,
  requireString,
  strField,
} from "@/brain/plugins/google/args";
import { toolDef } from "@/brain/plugins/google/catalog";
import { type GoogleClient, type Query } from "@/brain/plugins/google/http";
import { onlyIds } from "@/brain/plugins/google/plural";
import { isResult, openUser } from "@/brain/plugins/google/session";

const TASKS = "https://tasks.googleapis.com/tasks/v1";
const MAX_RESULTS_DEFAULT = 20;
const MAX_RESULTS_CAP = 10000;

type Handler = (args: Record<string, unknown>, call: CallContext) => Promise<ToolResult>;

export function tasksTools(ctx: PluginContext): Tool[] {
  const bind = (name: string, fn: Handler): Tool => ({ ...toolDef(name), call: fn });
  return [
    bind("tasks_list_tasklists", (args, call) => listTaskLists(ctx, args, call)),
    bind("tasks_get_tasklist", (args, call) => getTaskList(ctx, args, call)),
    bind("tasks_list_tasks", (args, call) => listTasks(ctx, args, call)),
    bind("tasks_get_task", (args, call) => getTask(ctx, args, call)),
    bind("tasks_create_tasklist", (args, call) => createTaskList(ctx, args, call)),
    bind("tasks_update_tasklist", (args, call) => updateTaskList(ctx, args, call)),
    bind("tasks_delete_tasklist", (args, call) => deleteTaskList(ctx, args, call)),
    bind("tasks_create_task", (args, call) => createTask(ctx, args, call)),
    bind("tasks_update_task", (args, call) => updateTask(ctx, args, call)),
    bind("tasks_delete_task", (args, call) => deleteTask(ctx, args, call)),
    bind("tasks_update_task_position", (args, call) => moveTask(ctx, args, call)),
    bind("tasks_delete_completed", (args, call) => clearCompleted(ctx, args, call)),
  ];
}

function seg(...parts: string[]): string {
  return `${TASKS}/${parts.map((part) => encodeURIComponent(part)).join("/")}`;
}

function must(args: Record<string, unknown>, key: string): string | ToolResult {
  try {
    return requireArgString(args, key);
  } catch (e) {
    if (e instanceof ArgTypeError) {
      return errorResult(e.message);
    }
    throw e;
  }
}

function isText(v: string | ToolResult): v is ToolResult {
  return typeof v !== "string";
}

async function listTaskLists(ctx: PluginContext, args: Record<string, unknown>, call: CallContext): Promise<ToolResult> {
  const opened = await openUser(ctx, args, call, "message");
  if (isResult(opened)) {
    return opened;
  }
  const query: Query = { maxResults: getInt(args, "max_results", 1000) };
  const pageToken = getString(args, "page_token", "");
  if (pageToken !== "") {
    query.pageToken = pageToken;
  }
  let result: unknown;
  try {
    result = await opened.api.get(seg("users", "@me", "lists"), query);
  } catch (e) {
    return errorResult(`listing task lists: ${errorText(e)}`);
  }
  const only = onlyIds(args);
  let items = arrField(result, "items");
  if (only) {
    items = items.filter((tl) => only.has(strField(tl, "id")));
    return jsonResult(items.map((tl) => ({ id: strField(tl, "id"), name: strField(tl, "title") })));
  }
  if (items.length === 0) {
    return textResult(`No task lists found for ${opened.email}.`);
  }
  let text = `Task Lists for ${opened.email}:\n`;
  for (const tl of items) {
    text += `- ${strField(tl, "title")} (ID: ${strField(tl, "id")})\n`;
    text += `  Updated: ${orNA(strField(tl, "updated"))}\n`;
  }
  const next = strField(result, "nextPageToken");
  if (next !== "") {
    text += `\nNext page token: ${next}`;
  }
  return textResult(text);
}

async function getTaskList(ctx: PluginContext, args: Record<string, unknown>, call: CallContext): Promise<ToolResult> {
  const opened = await openUser(ctx, args, call, "message");
  if (isResult(opened)) {
    return opened;
  }
  const taskListID = must(args, "task_list_id");
  if (isText(taskListID)) {
    return taskListID;
  }
  let tl: unknown;
  try {
    tl = await opened.api.get(seg("users", "@me", "lists", taskListID));
  } catch (e) {
    return errorResult(`getting task list: ${errorText(e)}`);
  }
  return textResult(`Task List Details for ${opened.email}:
- Title: ${strField(tl, "title")}
- ID: ${strField(tl, "id")}
- Updated: ${orNA(strField(tl, "updated"))}
- Self Link: ${orNA(strField(tl, "selfLink"))}`);
}

async function createTaskList(ctx: PluginContext, args: Record<string, unknown>, call: CallContext): Promise<ToolResult> {
  const opened = await openUser(ctx, args, call, "message");
  if (isResult(opened)) {
    return opened;
  }
  const title = must(args, "title");
  if (isText(title)) {
    return title;
  }
  let result: unknown;
  try {
    result = await opened.api.post(seg("users", "@me", "lists"), { title });
  } catch (e) {
    return errorResult(`creating task list: ${errorText(e)}`);
  }
  return textResult(`Task List Created for ${opened.email}:
- Title: ${strField(result, "title")}
- ID: ${strField(result, "id")}
- Created: ${orNA(strField(result, "updated"))}
- Self Link: ${orNA(strField(result, "selfLink"))}`);
}

async function updateTaskList(ctx: PluginContext, args: Record<string, unknown>, call: CallContext): Promise<ToolResult> {
  const opened = await openUser(ctx, args, call, "message");
  if (isResult(opened)) {
    return opened;
  }
  const taskListID = must(args, "task_list_id");
  if (isText(taskListID)) {
    return taskListID;
  }
  const title = must(args, "title");
  if (isText(title)) {
    return title;
  }
  let result: unknown;
  try {
    result = await opened.api.put(seg("users", "@me", "lists", taskListID), { id: taskListID, title });
  } catch (e) {
    return errorResult(`updating task list: ${errorText(e)}`);
  }
  return textResult(`Task List Updated for ${opened.email}:
- Title: ${strField(result, "title")}
- ID: ${strField(result, "id")}
- Updated: ${orNA(strField(result, "updated"))}`);
}

async function deleteTaskList(ctx: PluginContext, args: Record<string, unknown>, call: CallContext): Promise<ToolResult> {
  const opened = await openUser(ctx, args, call, "message");
  if (isResult(opened)) {
    return opened;
  }
  const taskListID = must(args, "task_list_id");
  if (isText(taskListID)) {
    return taskListID;
  }
  try {
    await opened.api.delete(seg("users", "@me", "lists", taskListID));
  } catch (e) {
    return errorResult(`deleting task list: ${errorText(e)}`);
  }
  return textResult(`Task list ${taskListID} has been deleted for ${opened.email}. All tasks in this list have also been deleted.`);
}

async function listTasks(ctx: PluginContext, args: Record<string, unknown>, call: CallContext): Promise<ToolResult> {
  const opened = await openUser(ctx, args, call, needArg("user_google_email", "tasks_list_tasks(task_list_id=\"@default\")"));
  if (isResult(opened)) {
    return opened;
  }
  const taskListID = requireString(args, "task_list_id");
  if (taskListID === undefined) {
    return needArg("task_list_id", "tasks_list_tasks(task_list_id=\"@default\")");
  }
  let loaded: { items: unknown[]; next: string };
  try {
    loaded = await loadTasks(opened.api, taskListID, args);
  } catch (e) {
    return errorResult(`listing tasks: ${errorText(e)}`);
  }
  if (loaded.items.length === 0) {
    return textResult(`No tasks found in task list ${taskListID} for ${opened.email}.`);
  }
  let text = `Tasks in list ${taskListID} for ${opened.email}:\n`;
  text += serializeTasks(structureTasks(loaded.items), 0);
  if (loaded.next !== "") {
    text += `Next page token: ${loaded.next}\n`;
  }
  return textResult(text);
}

async function loadTasks(api: GoogleClient, taskListID: string, args: Record<string, unknown>): Promise<{ items: unknown[]; next: string }> {
  const maxResults = getInt(args, "max_results", MAX_RESULTS_DEFAULT);
  const url = seg("lists", taskListID, "tasks");
  const first = await api.get(url, taskQuery(args, maxResults, getString(args, "page_token", "")));
  let items = arrField(first, "items");
  let next = strField(first, "nextPageToken");
  let remaining = Math.min(maxResults, MAX_RESULTS_CAP) - items.length;
  while (remaining > 0 && next !== "") {
    try {
      const more = await api.get(url, taskQuery(args, remaining, next));
      const extra = arrField(more, "items");
      if (extra.length === 0) {
        break;
      }
      items = items.concat(extra);
      next = strField(more, "nextPageToken");
      remaining -= extra.length;
    } catch {
      // Go stops paging when a later page fails and keeps what it already has.
      break;
    }
  }
  return { items, next };
}

function taskQuery(args: Record<string, unknown>, maxResults: number, pageToken: string): Query {
  const query: Query = {
    maxResults,
    showCompleted: getBoolOnly(args, "show_completed", true),
    showDeleted: getBoolOnly(args, "show_deleted", false),
    showHidden: getBoolOnly(args, "show_hidden", false),
    showAssigned: getBoolOnly(args, "show_assigned", false),
  };
  if (pageToken !== "") {
    query.pageToken = pageToken;
  }
  const completedMax = getString(args, "completed_max", "");
  const completedMin = getString(args, "completed_min", "");
  const dueMax = getString(args, "due_max", "");
  const dueMin = getString(args, "due_min", "");
  const updatedMin = getString(args, "updated_min", "");
  if (completedMax !== "") {
    query.completedMax = completedMax;
  }
  if (completedMin !== "") {
    query.completedMin = completedMin;
  }
  if (dueMax !== "") {
    query.dueMax = adjustDueMaxForTasksAPI(dueMax);
  }
  if (dueMin !== "") {
    query.dueMin = dueMin;
  }
  if (updatedMin !== "") {
    query.updatedMin = updatedMin;
  }
  return query;
}

async function getTask(ctx: PluginContext, args: Record<string, unknown>, call: CallContext): Promise<ToolResult> {
  const opened = await openUser(ctx, args, call, needArg("user_google_email", "tasks_get_task(task_list_id=\"@default\", task_id=…)"));
  if (isResult(opened)) {
    return opened;
  }
  const taskListID = requireString(args, "task_list_id");
  if (taskListID === undefined) {
    return needArg("task_list_id", "tasks_list_tasks(task_list_id=\"@default\") then tasks_get_task(task_list_id, task_id)");
  }
  const taskID = requireString(args, "task_id");
  if (taskID === undefined) {
    return needArg("task_id", "tasks_list_tasks(task_list_id=\"@default\") then tasks_get_task(task_list_id, task_id)");
  }
  let task: unknown;
  try {
    task = await opened.api.get(seg("lists", taskListID, "tasks", taskID));
  } catch (e) {
    return errorResult(`getting task: ${errorText(e)}`);
  }
  return textResult(formatTaskDetails(opened.email, task));
}

function formatTaskDetails(email: string, task: unknown): string {
  const title = strField(task, "title") || "Untitled";
  let text = `Task Details for ${email}:\n`;
  text += `- Title: ${title}\n`;
  text += `- ID: ${strField(task, "id")}\n`;
  text += `- Status: ${orNA(strField(task, "status"))}\n`;
  text += `- Updated: ${orNA(strField(task, "updated"))}`;
  if (strField(task, "due") !== "") {
    text += `\n- Due Date: ${strField(task, "due")}`;
  }
  const completed = completedOf(task);
  if (completed !== "") {
    text += `\n- Completed: ${completed}`;
  }
  if (strField(task, "notes") !== "") {
    text += `\n- Notes: ${strField(task, "notes")}`;
  }
  if (strField(task, "parent") !== "") {
    text += `\n- Parent Task ID: ${strField(task, "parent")}`;
  }
  if (strField(task, "position") !== "") {
    text += `\n- Position: ${strField(task, "position")}`;
  }
  if (strField(task, "selfLink") !== "") {
    text += `\n- Self Link: ${strField(task, "selfLink")}`;
  }
  if (strField(task, "webViewLink") !== "") {
    text += `\n- Web View Link: ${strField(task, "webViewLink")}`;
  }
  return text;
}

async function createTask(ctx: PluginContext, args: Record<string, unknown>, call: CallContext): Promise<ToolResult> {
  const opened = await openUser(ctx, args, call, needArg("user_google_email", "tasks_create_task(task_list_id=\"@default\", title=…)"));
  if (isResult(opened)) {
    return opened;
  }
  const taskListID = requireString(args, "task_list_id");
  if (taskListID === undefined) {
    return needArg("task_list_id", "tasks_create_task(task_list_id=\"@default\", title=…)");
  }
  const title = requireString(args, "title");
  if (title === undefined) {
    return needArg("title", "tasks_create_task(task_list_id=\"@default\", title=…)");
  }
  const notes = getString(args, "notes", "");
  const due = getString(args, "due", "");
  const parent = getString(args, "parent", "");
  const previous = getString(args, "previous", "");
  const body: Record<string, string> = { title };
  if (notes !== "") {
    body.notes = notes;
  }
  if (due !== "") {
    body.due = due;
  }
  const query: Query = {};
  if (parent !== "") {
    query.parent = parent;
  }
  if (previous !== "") {
    query.previous = previous;
  }
  let result: unknown;
  try {
    result = await opened.api.post(seg("lists", taskListID, "tasks"), body, query);
  } catch (e) {
    return errorResult(`creating task: ${errorText(e)}`);
  }
  let text = `Task Created for ${opened.email}:\n`;
  text += `- Title: ${strField(result, "title")}\n`;
  text += `- ID: ${strField(result, "id")}\n`;
  text += `- Status: ${orNA(strField(result, "status"))}\n`;
  text += `- Updated: ${orNA(strField(result, "updated"))}`;
  if (strField(result, "due") !== "") {
    text += `\n- Due Date: ${strField(result, "due")}`;
  }
  if (strField(result, "notes") !== "") {
    text += `\n- Notes: ${strField(result, "notes")}`;
  }
  if (strField(result, "webViewLink") !== "") {
    text += `\n- Web View Link: ${strField(result, "webViewLink")}`;
  }
  return textResult(text);
}

async function updateTask(ctx: PluginContext, args: Record<string, unknown>, call: CallContext): Promise<ToolResult> {
  const opened = await openUser(ctx, args, call, needArg("user_google_email", "tasks_update_task(task_list_id=\"@default\", task_id=…, …)"));
  if (isResult(opened)) {
    return opened;
  }
  const taskListID = requireString(args, "task_list_id");
  if (taskListID === undefined) {
    return needArg("task_list_id", "tasks_list_tasks(task_list_id=\"@default\") then tasks_update_task(task_list_id, task_id, …)");
  }
  const taskID = requireString(args, "task_id");
  if (taskID === undefined) {
    return needArg("task_id", "tasks_list_tasks(task_list_id=\"@default\") then tasks_update_task(task_list_id, task_id, …)");
  }
  let current: unknown;
  try {
    current = await opened.api.get(seg("lists", taskListID, "tasks", taskID));
  } catch (e) {
    return errorResult(`getting current task: ${errorText(e)}`);
  }
  const body: Record<string, string> = {
    id: taskID,
    title: hasKey(args, "title") ? getString(args, "title", "") : strField(current, "title"),
    status: hasKey(args, "status") ? getString(args, "status", "needsAction") : strField(current, "status"),
  };
  if (hasKey(args, "notes")) {
    const notes = typeof args.notes === "string" ? args.notes : "";
    if (notes !== "") {
      body.notes = notes;
    }
  } else if (strField(current, "notes") !== "") {
    body.notes = strField(current, "notes");
  }
  if (hasKey(args, "due")) {
    const due = typeof args.due === "string" ? args.due : "";
    if (due !== "") {
      body.due = due;
    }
  } else if (strField(current, "due") !== "") {
    body.due = strField(current, "due");
  }
  let result: unknown;
  try {
    result = await opened.api.put(seg("lists", taskListID, "tasks", taskID), body);
  } catch (e) {
    return errorResult(`updating task: ${errorText(e)}`);
  }
  let text = `Task Updated for ${opened.email}:\n`;
  text += `- Title: ${strField(result, "title")}\n`;
  text += `- ID: ${strField(result, "id")}\n`;
  text += `- Status: ${orNA(strField(result, "status"))}\n`;
  text += `- Updated: ${orNA(strField(result, "updated"))}`;
  if (strField(result, "due") !== "") {
    text += `\n- Due Date: ${strField(result, "due")}`;
  }
  if (strField(result, "notes") !== "") {
    text += `\n- Notes: ${strField(result, "notes")}`;
  }
  const completed = completedOf(result);
  if (completed !== "") {
    text += `\n- Completed: ${completed}`;
  }
  return textResult(text);
}

async function deleteTask(ctx: PluginContext, args: Record<string, unknown>, call: CallContext): Promise<ToolResult> {
  const opened = await openUser(ctx, args, call, needArg("user_google_email", "tasks_delete_task(task_list_id=\"@default\", task_id=…)"));
  if (isResult(opened)) {
    return opened;
  }
  const taskListID = requireString(args, "task_list_id");
  if (taskListID === undefined) {
    return needArg("task_list_id", "tasks_list_tasks(task_list_id=\"@default\") then tasks_delete_task(task_list_id, task_id)");
  }
  const taskID = requireString(args, "task_id");
  if (taskID === undefined) {
    return needArg("task_id", "tasks_list_tasks(task_list_id=\"@default\") then tasks_delete_task(task_list_id, task_id)");
  }
  try {
    await opened.api.delete(seg("lists", taskListID, "tasks", taskID));
  } catch (e) {
    return errorResult(`deleting task: ${errorText(e)}`);
  }
  return textResult(`Task ${taskID} has been deleted from task list ${taskListID} for ${opened.email}.`);
}

async function moveTask(ctx: PluginContext, args: Record<string, unknown>, call: CallContext): Promise<ToolResult> {
  const opened = await openUser(ctx, args, call, "message");
  if (isResult(opened)) {
    return opened;
  }
  const taskListID = must(args, "task_list_id");
  if (isText(taskListID)) {
    return taskListID;
  }
  const taskID = must(args, "task_id");
  if (isText(taskID)) {
    return taskID;
  }
  const parent = getString(args, "parent", "");
  const previous = getString(args, "previous", "");
  const destination = getString(args, "destination_task_list", "");
  const query: Query = {};
  if (parent !== "") {
    query.parent = parent;
  }
  if (previous !== "") {
    query.previous = previous;
  }
  if (destination !== "") {
    query.destinationTasklist = destination;
  }
  let result: unknown;
  try {
    result = await opened.api.post(`${seg("lists", taskListID, "tasks", taskID)}/move`, undefined, query);
  } catch (e) {
    return errorResult(`moving task: ${errorText(e)}`);
  }
  let text = `Task Moved for ${opened.email}:\n`;
  text += `- Title: ${strField(result, "title")}\n`;
  text += `- ID: ${strField(result, "id")}\n`;
  text += `- Status: ${orNA(strField(result, "status"))}\n`;
  text += `- Updated: ${orNA(strField(result, "updated"))}`;
  if (strField(result, "parent") !== "") {
    text += `\n- Parent Task ID: ${strField(result, "parent")}`;
  }
  if (strField(result, "position") !== "") {
    text += `\n- Position: ${strField(result, "position")}`;
  }
  const details: string[] = [];
  if (destination !== "") {
    details.push(`moved to task list ${destination}`);
  }
  if (parent !== "") {
    details.push(`made a subtask of ${parent}`);
  }
  if (previous !== "") {
    details.push(`positioned after ${previous}`);
  }
  if (details.length > 0) {
    text += `\n- Move Details: ${details.join(", ")}`;
  }
  return textResult(text);
}

async function clearCompleted(ctx: PluginContext, args: Record<string, unknown>, call: CallContext): Promise<ToolResult> {
  const opened = await openUser(ctx, args, call, "message");
  if (isResult(opened)) {
    return opened;
  }
  const taskListID = must(args, "task_list_id");
  if (isText(taskListID)) {
    return taskListID;
  }
  try {
    await opened.api.post(seg("lists", taskListID, "clear"), undefined);
  } catch (e) {
    return errorResult(`clearing completed tasks: ${errorText(e)}`);
  }
  return textResult(`All completed tasks have been cleared from task list ${taskListID} for ${opened.email}. The tasks are now hidden and won't appear in default task list views.`);
}

type Node = {
  id: string;
  title: string;
  status: string;
  due: string;
  notes: string;
  updated: string;
  completed: string;
  placeholder: boolean;
  subtasks: Node[];
};

function structureTasks(items: unknown[]): Node[] {
  const byId = new Map<string, Node>();
  const positions = new Map<string, bigint>();
  for (const item of items) {
    const id = strField(item, "id");
    byId.set(id, {
      id,
      title: strField(item, "title"),
      status: strField(item, "status"),
      due: strField(item, "due"),
      notes: strField(item, "notes"),
      updated: strField(item, "updated"),
      completed: completedOf(item),
      placeholder: false,
      subtasks: [],
    });
    const pos = parsePosition(strField(item, "position"));
    if (pos !== undefined) {
      positions.set(id, pos);
    }
  }
  const root: Node = { id: "root", title: "Root", status: "", due: "", notes: "", updated: "", completed: "", placeholder: false, subtasks: [] };
  for (const item of items) {
    const id = strField(item, "id");
    const node = byId.get(id);
    if (!node) {
      continue;
    }
    const parentID = strField(item, "parent");
    let parent = parentID === "" ? root : byId.get(parentID);
    if (!parent) {
      parent = { id: parentID, title: "", status: "", due: "", notes: "", updated: "", completed: "", placeholder: true, subtasks: [] };
      byId.set(parentID, parent);
      root.subtasks.push(parent);
    }
    parent.subtasks.push(node);
  }
  sortNodes(root, positions);
  return root.subtasks;
}

function sortNodes(node: Node, positions: Map<string, bigint>): void {
  node.subtasks.sort((a, b) => comparePos(positions.get(a.id), positions.get(b.id)));
  for (const child of node.subtasks) {
    sortNodes(child, positions);
  }
}

function comparePos(a: bigint | undefined, b: bigint | undefined): number {
  if (a === undefined && b === undefined) {
    return 0;
  }
  if (a === undefined) {
    return 1;
  }
  if (b === undefined) {
    return -1;
  }
  if (a < b) {
    return -1;
  }
  if (a > b) {
    return 1;
  }
  return 0;
}

function parsePosition(raw: string): bigint | undefined {
  const match = /^\s*([+-]?\d+)/u.exec(raw);
  const digits = match?.[1];
  if (!digits) {
    return undefined;
  }
  try {
    return BigInt(digits);
  } catch {
    return undefined;
  }
}

function serializeTasks(nodes: Node[], level: number): string {
  let text = "";
  let placeholders = 0;
  for (const node of nodes) {
    const indent = "  ".repeat(level);
    const bullet = level > 0 ? "*" : "-";
    let title = node.title;
    if (title === "") {
      if (node.placeholder) {
        title = "Unknown parent";
        placeholders += 1;
      } else {
        title = "Untitled";
      }
    }
    text += `${indent}${bullet} ${title} (ID: ${node.id})\n`;
    text += `${indent}  Status: ${orNA(node.status)}\n`;
    if (node.due !== "") {
      text += `${indent}  Due: ${node.due}\n`;
    }
    if (node.notes !== "") {
      const notes = node.notes.length > 100 ? `${node.notes.slice(0, 100)}...` : node.notes;
      text += `${indent}  Notes: ${notes}\n`;
    }
    if (node.completed !== "") {
      text += `${indent}  Completed: ${node.completed}\n`;
    }
    text += `${indent}  Updated: ${orNA(node.updated)}\n`;
    text += "\n";
    text += serializeTasks(node.subtasks, level + 1);
  }
  if (placeholders > 0 && level === 0) {
    text += `\n${placeholders} tasks with title Unknown parent are included as placeholders.\n`;
    text += "These placeholders contain subtasks whose parents were not present in the task list.\n";
    text += "This can occur due to pagination. Callers can often avoid this problem if max_results is large enough to contain all tasks (subtasks and their parents) without paging.\n";
    text += "This can also occur due to filtering that excludes parent tasks while including their subtasks or due to deleted or hidden parent tasks.\n";
  }
  return text;
}

function orNA(value: string): string {
  return value === "" ? "N/A" : value;
}

function completedOf(task: unknown): string {
  if (!isRecord(task) || typeof task.completed !== "string") {
    return "";
  }
  return task.completed;
}

/** Google Tasks treats dueMax as exclusive. Add one day, matching adjustDueMaxForTasksAPI. */
export function adjustDueMaxForTasksAPI(dueMax: string): string {
  const withZone = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(Z|[+-]\d{2}:\d{2})$/u.exec(dueMax);
  if (withZone) {
    const ms = Date.parse(dueMax);
    if (Number.isNaN(ms)) {
      return dueMax;
    }
    return formatOffset(new Date(ms + 24 * 60 * 60 * 1000), withZone[2] ?? "Z");
  }
  const bare = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})$/u.exec(dueMax);
  if (!bare) {
    return dueMax;
  }
  const ms = Date.parse(`${dueMax}Z`);
  if (Number.isNaN(ms)) {
    return dueMax;
  }
  return formatOffset(new Date(ms + 24 * 60 * 60 * 1000), "Z");
}

function formatOffset(date: Date, offset: string): string {
  if (offset === "Z") {
    return date.toISOString().replace(/\.\d{3}Z$/u, "Z");
  }
  const sign = offset.startsWith("-") ? -1 : 1;
  const hours = Number(offset.slice(1, 3));
  const minutes = Number(offset.slice(4, 6));
  const shifted = new Date(date.getTime() + sign * (hours * 60 + minutes) * 60 * 1000);
  return `${shifted.toISOString().replace(/\.\d{3}Z$/u, "")}${offset}`;
}
