import type { CallContext, PluginContext, Tool, ToolResult } from "@/harness/core/tools";
import { errorResult, jsonResult, textResult } from "@/harness/core/tools";
import {
  arrField,
  errorText,
  firstNonEmpty,
  getInt,
  getString,
  hasKey,
  getStringSlice,
  isRecord,
  mapBool,
  mapString,
  mapStringSlice,
  needArg,
  requireString,
  strField,
  toolHint,
} from "@/harness/plugins/google/args";
import { bogusCalendarEventID, correctTimeFormatForAPI, isAllDay, resolveListWindow, rfc3339Utc } from "@/harness/plugins/google/cal-time";
import { toolDef } from "@/harness/plugins/google/catalog";
import { onlyIds } from "@/harness/plugins/google/plural";
import { connect, type GoogleClient } from "@/harness/plugins/google/http";
import { EmailRequired, resolveEmail } from "@/harness/plugins/google/oauth";

const CAL = "https://www.googleapis.com/calendar/v3";
const MAX_BATCH = 50;

type Handler = (args: Record<string, unknown>, call: CallContext) => Promise<ToolResult>;

export function calendarTools(ctx: PluginContext): Tool[] {
  const bind = (name: string, fn: Handler): Tool => ({ ...toolDef(name), call: fn });
  return [
    bind("calendar_list_calendars", (args, call) => listCalendars(ctx, args, call)),
    bind("calendar_list_events", (args, call) => listEvents(ctx, args, call)),
    bind("calendar_get_event", (args, call) => getEvent(ctx, args, call)),
    bind("calendar_search_freebusy", (args, call) => freeBusy(ctx, args, call)),
    bind("calendar_create_events", (args, call) => createEvents(ctx, args, call)),
    bind("calendar_update_events", (args, call) => updateEvents(ctx, args, call)),
    bind("calendar_delete_event", (args, call) => deleteEvent(ctx, args, call)),
  ];
}

async function open(ctx: PluginContext, args: Record<string, unknown>, call: CallContext): Promise<{ email: string; api: GoogleClient }> {
  const email = await resolveEmail(ctx, args);
  const api = await connect(ctx, email, call.signal);
  return { email, api };
}

function emailFail(e: unknown, missing: ToolResult): ToolResult | undefined {
  if (e instanceof EmailRequired) {
    return missing;
  }
  return undefined;
}

async function listCalendars(ctx: PluginContext, args: Record<string, unknown>, call: CallContext): Promise<ToolResult> {
  let email: string;
  let api: GoogleClient;
  try {
    ({ email, api } = await open(ctx, args, call));
  } catch (e) {
    return emailFail(e, errorResult("user_google_email is required")) ?? errorResult(errorText(e));
  }
  try {
    const data = await api.get(`${CAL}/users/me/calendarList`);
    const only = onlyIds(args);
    let items = arrField(data, "items");
    if (only) {
      items = items.filter((cal) => only.has(strField(cal, "id")));
      return jsonResult(items.map((cal) => ({
        id: strField(cal, "id"),
        name: strField(cal, "summary"),
        primary: boolPrimary(cal),
      })));
    }
    if (items.length === 0) {
      return textResult(`No calendars found for ${email}.`);
    }
    let text = `Successfully listed ${items.length} calendars for ${email}:`;
    for (const cal of items) {
      const summary = strField(cal, "summary") || "No Summary";
      const primary = boolPrimary(cal) ? " (Primary)" : "";
      text += `\n- "${summary}"${primary} (ID: ${strField(cal, "id")})`;
    }
    return textResult(text);
  } catch (e) {
    return errorResult(`listing calendars: ${errorText(e)}`);
  }
}

function boolPrimary(v: unknown): boolean {
  return isRecord(v) && v.primary === true;
}

function clampDays(days: number): number {
  if (days < 1) {
    return 7;
  }
  return Math.min(days, 31);
}

function listWindow(
  args: Record<string, unknown>,
  timeMin: string,
  timeMax: string,
  nowMs: number,
): { min: string; max: string; defaultedMax: boolean; days?: number } {
  if (timeMin === "" && timeMax === "") {
    const span = clampDays(hasKey(args, "days") ? getInt(args, "days", 7) : 7);
    return {
      min: rfc3339Utc(nowMs),
      max: rfc3339Utc(nowMs + span * 24 * 60 * 60 * 1000),
      defaultedMax: false,
      days: span,
    };
  }
  if (timeMax === "" && hasKey(args, "days")) {
    const span = clampDays(getInt(args, "days", 7));
    const min = correctTimeFormatForAPI(timeMin) || rfc3339Utc(nowMs);
    const parsed = Date.parse(min);
    const max = rfc3339Utc((Number.isNaN(parsed) ? nowMs : parsed) + span * 24 * 60 * 60 * 1000);
    return { min, max, defaultedMax: false };
  }
  return resolveListWindow(timeMin, timeMax, nowMs);
}

async function listEvents(ctx: PluginContext, args: Record<string, unknown>, call: CallContext): Promise<ToolResult> {
  let email: string;
  let api: GoogleClient;
  try {
    ({ email, api } = await open(ctx, args, call));
  } catch (e) {
    return emailFail(e, needArg("user_google_email", `calendar_list_events(time_min, time_max, calendar_id="primary")`)) ?? errorResult(errorText(e));
  }
  let calendarID = getString(args, "calendar_id", "primary");
  if (calendarID.trim() === "") {
    calendarID = "primary";
  }
  const timeMin = getString(args, "time_min", "");
  const timeMax = getString(args, "time_max", "");
  const maxResults = getInt(args, "max_results", 25);
  const query = getString(args, "query", "");
  const window = listWindow(args, timeMin, timeMax, ctx.clock.now());
  try {
    const data = await api.get(`${CAL}/calendars/${encodeURIComponent(calendarID)}/events`, {
      timeMin: window.min,
      timeMax: window.max,
      maxResults,
      singleEvents: true,
      orderBy: "startTime",
      q: query || undefined,
    });
    const items = arrField(data, "items");
    if (items.length === 0) {
      return textResult(`No events found in calendar '${calendarID}' for ${email} for the specified time range.`);
    }
    let text = `Successfully retrieved ${items.length} events from calendar '${calendarID}' for ${email}:`;
    if (window.days) {
      text += `\n(Note: time_min and time_max were omitted — used a ${window.days}-day window ending ${window.max}. Next: pass time_min/time_max or days.)`;
    } else if (window.defaultedMax) {
      text += `\n(Note: time_max was omitted — used a 24h window ending ${window.max}. Next: pass time_max for the day.)`;
    }
    for (const item of items) {
      const summary = strField(item, "summary") || "No Title";
      const link = strField(item, "htmlLink") || "No Link";
      const id = strField(item, "id") || "No ID";
      const start = eventTime(isRecord(item) ? item.start : undefined);
      const end = eventTime(isRecord(item) ? item.end : undefined);
      text += `\n- "${summary}" (Starts: ${start}, Ends: ${end}) ID: ${id} | Link: ${link}`;
    }
    return textResult(text);
  } catch (e) {
    return errorResult(`listing events: ${errorText(e)}`);
  }
}

async function getEvent(ctx: PluginContext, args: Record<string, unknown>, call: CallContext): Promise<ToolResult> {
  let email: string;
  let api: GoogleClient;
  try {
    ({ email, api } = await open(ctx, args, call));
  } catch (e) {
    return emailFail(e, needArg("user_google_email", "calendar_get_event(event_id=…)")) ?? errorResult(errorText(e));
  }
  const rawID = requireString(args, "event_id");
  if (rawID === undefined) {
    return needArg("event_id", `calendar_get_event(event_id=…) or calendar_list_events(time_min, time_max)`);
  }
  const eventID = rawID.trim();
  if (eventID === "" || bogusCalendarEventID(eventID)) {
    return toolHint("event_id looks like a calendar id or date/range", `calendar_list_events(time_min, time_max, calendar_id="primary")`);
  }
  let calendarID = getString(args, "calendar_id", "primary");
  if (calendarID.trim() === "") {
    calendarID = "primary";
  }
  try {
    const item = await api.get(`${CAL}/calendars/${encodeURIComponent(calendarID)}/events/${encodeURIComponent(eventID)}`);
    if (!isRecord(item)) {
      return textResult(`Event with ID '${eventID}' not found in calendar '${calendarID}' for ${email}.`);
    }
    return textResult(formatDetailedSingleEvent(item, eventID));
  } catch (e) {
    return errorResult(`getting event ${eventID}: ${errorText(e)}`);
  }
}

async function freeBusy(ctx: PluginContext, args: Record<string, unknown>, call: CallContext): Promise<ToolResult> {
  let email: string;
  let api: GoogleClient;
  try {
    ({ email, api } = await open(ctx, args, call));
  } catch (e) {
    return emailFail(e, errorResult("user_google_email is required")) ?? errorResult(errorText(e));
  }
  const timeMin = requireString(args, "time_min");
  if (timeMin === undefined) {
    return errorResult("time_min is required");
  }
  const timeMax = requireString(args, "time_max");
  if (timeMax === undefined) {
    return errorResult("time_max is required");
  }
  const ids = getStringSlice(args, "calendar_ids");
  const calendarIDs = ids && ids.length > 0 ? ids : ["primary"];
  const formattedTimeMin = correctTimeFormatForAPI(timeMin);
  const formattedTimeMax = correctTimeFormatForAPI(timeMax);
  const body: Record<string, unknown> = {
    timeMin: formattedTimeMin,
    timeMax: formattedTimeMax,
    items: calendarIDs.map((id) => ({ id })),
  };
  const groupExpansionMax = getInt(args, "group_expansion_max", 0);
  const calendarExpansionMax = getInt(args, "calendar_expansion_max", 0);
  if (groupExpansionMax > 0) {
    body.groupExpansionMax = groupExpansionMax;
  }
  if (calendarExpansionMax > 0) {
    body.calendarExpansionMax = calendarExpansionMax;
  }
  try {
    const resp = await api.post(`${CAL}/freeBusy`, body);
    const calendars = isRecord(resp) && isRecord(resp.calendars) ? resp.calendars : undefined;
    const keys = calendars ? Object.keys(calendars) : [];
    if (!calendars || keys.length === 0) {
      return textResult(`No free/busy information found for the requested calendars for ${email}.`);
    }
    const timeMinResult = strField(resp, "timeMin") || formattedTimeMin;
    const timeMaxResult = strField(resp, "timeMax") || formattedTimeMax;
    let text = `Free/Busy information for ${email}:\nTime range: ${timeMinResult} to ${timeMaxResult}\n`;
    for (const calID of keys) {
      const calData = calendars[calID];
      text += `\nCalendar: ${calID}`;
      const errors = arrField(calData, "errors");
      if (errors.length > 0) {
        text += "\n  Errors:";
        for (const err of errors) {
          text += `\n    - ${strField(err, "domain")}: ${strField(err, "reason")}`;
        }
        text += "\n";
        continue;
      }
      const busy = arrField(calData, "busy");
      if (busy.length === 0) {
        text += "\n  Status: Free (no busy periods)";
      } else {
        text += `\n  Busy periods: ${busy.length}`;
        for (const period of busy) {
          text += `\n    - ${strField(period, "start")} to ${strField(period, "end")}`;
        }
      }
      text += "\n";
    }
    return textResult(text);
  } catch (e) {
    return errorResult(`querying free/busy: ${errorText(e)}`);
  }
}

async function createEvents(ctx: PluginContext, args: Record<string, unknown>, call: CallContext): Promise<ToolResult> {
  let email: string;
  let api: GoogleClient;
  try {
    ({ email, api } = await open(ctx, args, call));
  } catch (e) {
    return emailFail(e, needArg("user_google_email", `calendar_create_events(events=[{summary, start_time, end_time}, …])`)) ?? errorResult(errorText(e));
  }
  const items = parseEventObjects(args.events);
  if (!items || items.length === 0) {
    return needArg("events", `calendar_create_events(events=[{summary, start_time, end_time}, …])`);
  }
  if (items.length > MAX_BATCH) {
    return errorResult(`at most ${MAX_BATCH} events per call`);
  }
  const defaultCal = getString(args, "calendar_id", "primary");
  const defaultTZ = getString(args, "timezone", "");
  const defaultSend = getString(args, "send_updates", "");
  let text = `Created events for ${email}:`;
  let okN = 0;
  for (let i = 0; i < items.length; i += 1) {
    const item = items[i];
    if (!item) {
      continue;
    }
    try {
      const line = await createOne(ctx, api, defaultCal, defaultTZ, defaultSend, item, i);
      okN += 1;
      text += `\n- [${i + 1}] ${line}`;
    } catch (e) {
      text += `\n- [${i + 1}] failed: ${errorText(e)}`;
    }
  }
  text += `\n${okN} of ${items.length} created.`;
  if (okN === 0) {
    return errorResult(text);
  }
  return textResult(text);
}

async function updateEvents(ctx: PluginContext, args: Record<string, unknown>, call: CallContext): Promise<ToolResult> {
  let email: string;
  let api: GoogleClient;
  try {
    ({ email, api } = await open(ctx, args, call));
  } catch (e) {
    return emailFail(e, needArg("user_google_email", `calendar_update_events(events=[{event_id, start_time, end_time}, …])`)) ?? errorResult(errorText(e));
  }
  const items = parseEventObjects(args.events);
  if (!items || items.length === 0) {
    return needArg("events", `calendar_update_events(events=[{event_id, …}, …])`);
  }
  if (items.length > MAX_BATCH) {
    return errorResult(`at most ${MAX_BATCH} events per call`);
  }
  const defaultCal = getString(args, "calendar_id", "primary");
  const defaultTZ = getString(args, "timezone", "");
  const defaultSend = getString(args, "send_updates", "");
  let text = `Updated events for ${email}:`;
  let okN = 0;
  for (let i = 0; i < items.length; i += 1) {
    const item = items[i];
    if (!item) {
      continue;
    }
    try {
      const line = await updateOne(api, defaultCal, defaultTZ, defaultSend, item, ctx, i);
      okN += 1;
      text += `\n- [${i + 1}] ${line}`;
    } catch (e) {
      text += `\n- [${i + 1}] failed: ${errorText(e)}`;
    }
  }
  text += `\n${okN} of ${items.length} updated.`;
  if (okN === 0) {
    return errorResult(text);
  }
  return textResult(text);
}

async function deleteEvent(ctx: PluginContext, args: Record<string, unknown>, call: CallContext): Promise<ToolResult> {
  let email: string;
  let api: GoogleClient;
  try {
    ({ email, api } = await open(ctx, args, call));
  } catch (e) {
    return emailFail(e, needArg("user_google_email", "calendar_delete_event(event_id=…)")) ?? errorResult(errorText(e));
  }
  const eventID = requireString(args, "event_id");
  if (eventID === undefined) {
    return needArg("event_id", `calendar_list_events(time_min, time_max) then calendar_delete_event(event_id)`);
  }
  let calendarID = getString(args, "calendar_id", "");
  if (calendarID === "") {
    calendarID = "primary";
  }
  const url = `${CAL}/calendars/${encodeURIComponent(calendarID)}/events/${encodeURIComponent(eventID)}`;
  try {
    await api.get(url);
  } catch {
    return errorResult(`Event not found. The event with ID '${eventID}' could not be found in calendar '${calendarID}'. This may be due to incorrect ID format or the event no longer exists.`);
  }
  try {
    await api.delete(url);
  } catch (e) {
    return errorResult(`deleting event: ${errorText(e)}`);
  }
  return textResult(`Successfully deleted event (ID: ${eventID}) from calendar '${calendarID}' for ${email}.`);
}

export function parseEventObjects(raw: unknown): Record<string, unknown>[] | undefined {
  if (raw == null) {
    return undefined;
  }
  if (typeof raw === "string") {
    try {
      const parsed: unknown = JSON.parse(raw);
      return objectsOnly(parsed);
    } catch {
      return undefined;
    }
  }
  return objectsOnly(raw);
}

function objectsOnly(raw: unknown): Record<string, unknown>[] | undefined {
  if (!Array.isArray(raw)) {
    return undefined;
  }
  const items: Record<string, unknown>[] = [];
  for (const item of raw) {
    if (!isRecord(item)) {
      return undefined;
    }
    items.push(item);
  }
  return items;
}

async function createOne(
  ctx: PluginContext,
  api: GoogleClient,
  defaultCal: string,
  defaultTZ: string,
  defaultSend: string,
  fields: Record<string, unknown>,
  index: number,
): Promise<string> {
  const summary = mapString(fields, "summary");
  if (summary === undefined || summary.trim() === "") {
    throw new Error("summary is required");
  }
  const startTime = mapString(fields, "start_time");
  if (startTime === undefined || startTime.trim() === "") {
    throw new Error("start_time is required");
  }
  const endTime = mapString(fields, "end_time");
  if (endTime === undefined || endTime.trim() === "") {
    throw new Error("end_time is required");
  }
  const calendarID = firstNonEmpty(mapString(fields, "calendar_id") ?? "", defaultCal, "primary");
  const timezone = firstNonEmpty(mapString(fields, "timezone") ?? "", defaultTZ);
  const body: Record<string, unknown> = {
    summary,
    start: eventDateTime(startTime, timezone),
    end: eventDateTime(endTime, timezone),
  };
  const description = mapString(fields, "description");
  if (description !== undefined) {
    body.description = description;
  }
  const location = mapString(fields, "location");
  if (location !== undefined) {
    body.location = location;
  }
  const attendees = mapStringSlice(fields, "attendees");
  if (attendees) {
    body.attendees = attendees.map((email) => ({ email }));
  }
  const query: Record<string, string | number | boolean | undefined> = {};
  if (mapBool(fields, "add_google_meet") === true) {
    body.conferenceData = {
      createRequest: {
        requestId: `meet-${ctx.clock.now()}-${index}`,
        conferenceSolutionKey: { type: "hangoutsMeet" },
      },
    };
    query.conferenceDataVersion = 1;
  }
  const sendUpdates = normalizeSendUpdates(firstNonEmpty(mapString(fields, "send_updates") ?? "", defaultSend), attendees !== undefined && attendees.length > 0);
  if (sendUpdates) {
    query.sendUpdates = sendUpdates;
  }
  const created = await api.post(`${CAL}/calendars/${encodeURIComponent(calendarID)}/events`, body, query);
  const link = strField(created, "htmlLink") || "No link available";
  return `created '${strField(created, "summary")}' (ID: ${strField(created, "id")}) Link: ${link}`;
}

async function updateOne(
  api: GoogleClient,
  defaultCal: string,
  defaultTZ: string,
  defaultSend: string,
  fields: Record<string, unknown>,
  ctx: PluginContext,
  index: number,
): Promise<string> {
  let eventID = mapString(fields, "event_id") ?? "";
  eventID = eventID.trim();
  if (eventID === "" || bogusCalendarEventID(eventID)) {
    throw new Error("event_id is required");
  }
  const calendarID = firstNonEmpty(mapString(fields, "calendar_id") ?? "", defaultCal, "primary");
  const timezone = firstNonEmpty(mapString(fields, "timezone") ?? "", defaultTZ);
  const url = `${CAL}/calendars/${encodeURIComponent(calendarID)}/events/${encodeURIComponent(eventID)}`;
  let existing: unknown;
  try {
    existing = await api.get(url);
  } catch (e) {
    throw new Error(`event ${eventID} not found: ${errorText(e)}`, { cause: e });
  }
  if (!isRecord(existing)) {
    throw new Error(`event ${eventID} not found: empty response`);
  }
  const hadGuests = arrField(existing, "attendees").length > 0;
  const summary = mapString(fields, "summary");
  if (summary !== undefined) {
    existing.summary = summary;
  }
  const description = mapString(fields, "description");
  if (description !== undefined) {
    existing.description = description;
  }
  const location = mapString(fields, "location");
  if (location !== undefined) {
    existing.location = location;
  }
  const startTime = mapString(fields, "start_time");
  if (startTime !== undefined) {
    existing.start = eventDateTime(startTime, timezone);
  }
  const endTime = mapString(fields, "end_time");
  if (endTime !== undefined) {
    existing.end = eventDateTime(endTime, timezone);
  }
  const attendees = mapStringSlice(fields, "attendees");
  if (attendees) {
    existing.attendees = attendees.map((email) => ({ email }));
  }
  const addMeet = mapBool(fields, "add_google_meet");
  if (addMeet === true) {
    existing.conferenceData = {
      createRequest: {
        requestId: `meet-${ctx.clock.now()}-${index}`,
        conferenceSolutionKey: { type: "hangoutsMeet" },
      },
    };
  } else if (addMeet === false) {
    existing.conferenceData = {};
  }
  const sendUpdates = normalizeSendUpdates(
    firstNonEmpty(mapString(fields, "send_updates") ?? "", defaultSend),
    hadGuests || (attendees !== undefined && attendees.length > 0),
  );
  const updated = await api.put(url, existing, { conferenceDataVersion: 1, sendUpdates: sendUpdates || undefined });
  const link = strField(updated, "htmlLink") || "No link available";
  return `updated '${strField(updated, "summary")}' (ID: ${eventID}) Link: ${link}`;
}

function normalizeSendUpdates(explicit: string, hasGuests: boolean): string {
  const value = explicit.trim();
  if (value === "") {
    return hasGuests ? "all" : "";
  }
  if (value === "all" || value === "externalOnly" || value === "none") {
    return value;
  }
  throw new Error("send_updates must be all, externalOnly, or none");
}

function eventDateTime(value: string, timezone: string): Record<string, unknown> {
  if (isAllDay(value)) {
    return { date: value };
  }
  const out: Record<string, unknown> = { dateTime: value };
  if (timezone) {
    out.timeZone = timezone;
  }
  return out;
}

function eventTime(edt: unknown): string {
  if (!isRecord(edt)) {
    return "Unknown";
  }
  if (typeof edt.dateTime === "string" && edt.dateTime) {
    return edt.dateTime;
  }
  if (typeof edt.date === "string" && edt.date) {
    return edt.date;
  }
  return "Unknown";
}

function formatDetailedSingleEvent(item: Record<string, unknown>, eventID: string): string {
  const summary = strField(item, "summary") || "No Title";
  const startTime = eventTime(item.start);
  const endTime = eventTime(item.end);
  const link = strField(item, "htmlLink") || "No Link";
  const description = strField(item, "description") || "No Description";
  const location = strField(item, "location") || "No Location";
  const colorID = strField(item, "colorId") || "None";
  const attendees = arrField(item, "attendees");
  const emails = attendees.length === 0
    ? "None"
    : attendees.map((a) => strField(a, "email")).join(", ");
  const details = formatAttendeeDetails(attendees);
  const attachments = formatAttachments(arrField(item, "attachments"));
  return `Event Details:\n- Title: ${summary}\n- Starts: ${startTime}\n- Ends: ${endTime}\n- Description: ${description}\n- Location: ${location}\n- Color ID: ${colorID}\n- Attendees: ${emails}\n- Attendee Details: ${details}\n- Attachments: ${attachments}\n- Event ID: ${eventID}\n- Link: ${link}`;
}

function formatAttendeeDetails(attendees: unknown[]): string {
  if (attendees.length === 0) {
    return "None";
  }
  return attendees.map((a) => {
    const email = strField(a, "email");
    const status = strField(a, "responseStatus") || "needsAction";
    let detail = `${email} (${status})`;
    if (isRecord(a) && a.organizer === true) {
      detail += " [organizer]";
    }
    if (isRecord(a) && a.optional === true) {
      detail += " [optional]";
    }
    return detail;
  }).join(", ");
}

function formatAttachments(attachments: unknown[]): string {
  if (attachments.length === 0) {
    return "None";
  }
  return attachments.map((att) => {
    const title = strField(att, "title") || "Untitled";
    return `${title} (URL: ${strField(att, "fileUrl")}, MIME: ${strField(att, "mimeType")}, FileID: ${strField(att, "fileId")})`;
  }).join(", ");
}
