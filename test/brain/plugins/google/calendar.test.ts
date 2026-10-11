import { describe, expect, it } from "vitest";
import { bogusCalendarEventID, correctTimeFormatForAPI, defaultTimeMaxAfter, isAllDay, resolveListWindow } from "@/brain/plugins/google/cal-time";
import { parseEventObjects } from "@/brain/plugins/google/calendar";
import { callTool, jsonResponse, liveToken, recordingFetch, testCtx, textOf, NOW } from "@/test/brain/plugins/google/harness";

describe("calendar time helpers", () => {
  it("corrects bare dates and missing zones", () => {
    const cases = [
      ["", ""],
      ["2024-05-12T10:00:00Z", "2024-05-12T10:00:00Z"],
      ["2024-05-12", "2024-05-12T00:00:00Z"],
      ["2024-05-12T10:00:00", "2024-05-12T10:00:00Z"],
      ["2024-05-12T10:00:00+05:00", "2024-05-12T10:00:00+05:00"],
      ["2024-05-12T10:00:00-07:00", "2024-05-12T10:00:00-07:00"],
      ["2024-01-01T00:00:00Z", "2024-01-01T00:00:00Z"],
    ] as const;
    for (const [input, want] of cases) {
      expect(correctTimeFormatForAPI(input)).toBe(want);
    }
  });

  it("treats a missing T as all-day", () => {
    expect(isAllDay("2024-05-12")).toBe(true);
    expect(isAllDay("2024-05-12T10:00:00Z")).toBe(false);
    expect(isAllDay("2024-05-12T10:00:00-07:00")).toBe(false);
    expect(isAllDay("")).toBe(true);
  });

  it("defaults a missing time_max to 24h after time_min, keeping the offset", () => {
    const window = resolveListWindow("2026-07-28T00:00:00-07:00", "", NOW);
    expect(window.defaultedMax).toBe(true);
    expect(window.min).toBe("2026-07-28T00:00:00-07:00");
    expect(window.max).toBe("2026-07-29T00:00:00-07:00");
    const explicit = resolveListWindow("2026-07-28T00:00:00-07:00", "2026-07-28T23:59:59-07:00", NOW);
    expect(explicit.defaultedMax).toBe(false);
    expect(explicit.max).toBe("2026-07-28T23:59:59-07:00");
    expect(defaultTimeMaxAfter("2026-07-28T15:00:00Z", NOW)).toBe("2026-07-29T15:00:00Z");
  });

  it("rejects calendar ids and dates used as event ids", () => {
    expect(bogusCalendarEventID("primary")).toBe(true);
    expect(bogusCalendarEventID("2026-07-28T00:00:00-07:00")).toBe(true);
    expect(bogusCalendarEventID("realEventId123")).toBe(false);
  });

  it("parses an events array or JSON string", () => {
    expect(parseEventObjects([{ event_id: "a" }, { event_id: "b" }])?.[1]?.event_id).toBe("b");
    expect(parseEventObjects("not-json")).toBeUndefined();
    expect(parseEventObjects("[{\"event_id\":\"z\"}]")?.[0]?.event_id).toBe("z");
  });
});

describe("calendar tools", () => {
  it("lists calendars with the primary marker", async () => {
    const { fetch, hits } = recordingFetch((hit) => {
      expect(hit.url.pathname).toBe("/calendar/v3/users/me/calendarList");
      expect(hit.authorization).toBe("Bearer ya29.access");
      return jsonResponse({
        items: [
          { id: "primary@example.com", summary: "My Calendar", primary: true },
          { id: "work@example.com", summary: "Work Calendar" },
          { id: "blank", summary: "" },
        ],
      });
    });
    const result = await callTool(testCtx({ token: liveToken(), fetch }), "calendar_list_calendars");
    expect(result.isError).toBeUndefined();
    const text = textOf(result);
    expect(text).toContain("Successfully listed 3 calendars for test@example.com:");
    expect(text).toContain(`- "My Calendar" (Primary) (ID: primary@example.com)`);
    expect(text).toContain(`- "Work Calendar" (ID: work@example.com)`);
    expect(text).toContain(`- "No Summary" (ID: blank)`);
    expect(hits).toHaveLength(1);
  });

  it("says when the account has no calendars", async () => {
    const { fetch } = recordingFetch(() => jsonResponse({ items: [] }));
    const text = textOf(await callTool(testCtx({ token: liveToken(), fetch }), "calendar_list_calendars"));
    expect(text).toBe("No calendars found for test@example.com.");
  });

  it("lists events and notes a defaulted 24h window", async () => {
    const { fetch } = recordingFetch((hit) => {
      expect(hit.url.searchParams.get("timeMin")).toBe("2026-07-28T00:00:00-07:00");
      expect(hit.url.searchParams.get("timeMax")).toBe("2026-07-29T00:00:00-07:00");
      expect(hit.url.searchParams.get("singleEvents")).toBe("true");
      expect(hit.url.searchParams.get("orderBy")).toBe("startTime");
      expect(hit.url.searchParams.get("maxResults")).toBe("25");
      return jsonResponse({
        items: [
          {
            id: "evt001",
            summary: "Team Standup",
            htmlLink: "https://calendar.google.com/event?eid=evt001",
            start: { dateTime: "2026-07-28T09:00:00-07:00" },
            end: { dateTime: "2026-07-28T09:30:00-07:00" },
          },
          { id: "evt002", summary: "", start: { date: "2026-07-28" }, end: { date: "2026-07-29" } },
        ],
      });
    });
    const text = textOf(await callTool(testCtx({ token: liveToken(), fetch }), "calendar_list_events", {
      time_min: "2026-07-28T00:00:00-07:00",
    }));
    expect(text).toContain("Successfully retrieved 2 events from calendar 'primary' for test@example.com:");
    expect(text).toContain("time_max was omitted — used a 24h window ending 2026-07-29T00:00:00-07:00");
    expect(text).toContain(`- "Team Standup" (Starts: 2026-07-28T09:00:00-07:00, Ends: 2026-07-28T09:30:00-07:00) ID: evt001 | Link: https://calendar.google.com/event?eid=evt001`);
    expect(text).toContain(`- "No Title" (Starts: 2026-07-28, Ends: 2026-07-29) ID: evt002 | Link: No Link`);
  });

  it("returns event details", async () => {
    const { fetch } = recordingFetch(() => jsonResponse({
      id: "evt001",
      summary: "Important Meeting",
      description: "Full details here",
      location: "Conference Room B",
      htmlLink: "https://calendar.google.com/event?eid=evt001",
      start: { dateTime: "2026-02-20T10:00:00Z" },
      end: { dateTime: "2026-02-20T11:00:00Z" },
      attendees: [{ email: "alice@example.com", responseStatus: "accepted", organizer: true }],
    }));
    const text = textOf(await callTool(testCtx({ token: liveToken(), fetch }), "calendar_get_event", { event_id: "evt001" }));
    expect(text).toContain("Event Details:");
    expect(text).toContain("- Title: Important Meeting");
    expect(text).toContain("- Description: Full details here");
    expect(text).toContain("- Location: Conference Room B");
    expect(text).toContain("alice@example.com (accepted) [organizer]");
    expect(text).toContain("- Event ID: evt001");
    expect(text).toContain("- Attachments: None");
  });

  it("rejects a calendar id used as an event id", async () => {
    const result = await callTool(testCtx({ token: liveToken() }), "calendar_get_event", { event_id: "primary" });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("calendar_list_events");
  });

  it("requires event_id", async () => {
    const result = await callTool(testCtx({ token: liveToken() }), "calendar_get_event", {});
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("event_id is required");
  });

  it("creates events and invites attendees with sendUpdates=all", async () => {
    const { fetch } = recordingFetch(async (hit) => {
      expect(hit.method).toBe("POST");
      expect(hit.url.pathname).toBe("/calendar/v3/calendars/primary/events");
      expect(hit.url.searchParams.get("sendUpdates")).toBe("all");
      const body = JSON.parse(hit.body) as { summary: string; start: { dateTime: string }; attendees: { email: string }[] };
      expect(body.summary).toBe("Planning Session");
      expect(body.start.dateTime).toBe("2026-02-25T14:00:00Z");
      expect(body.attendees.map((a) => a.email)).toEqual(["alice@example.com", "bob@example.com"]);
      return jsonResponse({ id: "new-evt-003", summary: "Planning Session", htmlLink: "https://calendar.google.com/event?eid=new-evt-003" });
    });
    const text = textOf(await callTool(testCtx({ token: liveToken(), fetch }), "calendar_create_events", {
      events: [{
        summary: "Planning Session",
        start_time: "2026-02-25T14:00:00Z",
        end_time: "2026-02-25T16:00:00Z",
        attendees: ["alice@example.com", "bob@example.com"],
        description: "Quarterly planning",
        location: "Main Conference Room",
      }],
    }));
    expect(text).toContain("Created events for test@example.com:");
    expect(text).toContain("[1] created 'Planning Session' (ID: new-evt-003) Link: https://calendar.google.com/event?eid=new-evt-003");
    expect(text).toContain("1 of 1 created.");
  });

  it("creates an all-day event with a date, not a dateTime", async () => {
    const { fetch } = recordingFetch(async (hit) => {
      const body = JSON.parse(hit.body) as { start: { date?: string; dateTime?: string } };
      expect(body.start.date).toBe("2026-03-01");
      expect(body.start.dateTime).toBeUndefined();
      expect(hit.url.searchParams.get("sendUpdates")).toBeNull();
      return jsonResponse({ id: "new-evt-002", summary: "Team Offsite", htmlLink: "https://calendar.google.com/event?eid=new-evt-002" });
    });
    const text = textOf(await callTool(testCtx({ token: liveToken(), fetch }), "calendar_create_events", {
      events: [{ summary: "Team Offsite", start_time: "2026-03-01", end_time: "2026-03-02" }],
    }));
    expect(text).toContain("created 'Team Offsite'");
  });

  it("requires events", async () => {
    const result = await callTool(testCtx({ token: liveToken() }), "calendar_create_events", {});
    expect(result.isError).toBe(true);
    expect(textOf(result).toLowerCase()).toContain("events");
  });

  it("reports free/busy blocks", async () => {
    const { fetch } = recordingFetch(async (hit) => {
      const body = JSON.parse(hit.body) as { timeMin: string; items: { id: string }[] };
      expect(body.timeMin).toBe("2026-01-01T00:00:00Z");
      expect(body.items.map((i) => i.id)).toEqual(["primary", "ada@example.com"]);
      return jsonResponse({
        timeMin: "2026-01-01T00:00:00Z",
        timeMax: "2026-01-02T00:00:00Z",
        calendars: {
          primary: { busy: [{ start: "2026-01-01T15:00:00Z", end: "2026-01-01T16:00:00Z" }] },
          "ada@example.com": { busy: [] },
        },
      });
    });
    const text = textOf(await callTool(testCtx({ token: liveToken(), fetch }), "calendar_search_freebusy", {
      time_min: "2026-01-01T00:00:00Z",
      time_max: "2026-01-02T00:00:00Z",
      calendar_ids: ["primary", "ada@example.com"],
    }));
    expect(text).toContain("Free/Busy information for test@example.com:");
    expect(text).toContain("Time range: 2026-01-01T00:00:00Z to 2026-01-02T00:00:00Z");
    expect(text).toContain("Calendar: primary");
    expect(text).toContain("Busy periods: 1");
    expect(text).toContain("- 2026-01-01T15:00:00Z to 2026-01-01T16:00:00Z");
    expect(text).toContain("Calendar: ada@example.com");
    expect(text).toContain("Status: Free (no busy periods)");
  });

  it("requires time_min then time_max for free/busy", async () => {
    const missingMin = await callTool(testCtx({ token: liveToken() }), "calendar_search_freebusy", {});
    expect(textOf(missingMin).toLowerCase()).toContain("time_min");
    const missingMax = await callTool(testCtx({ token: liveToken() }), "calendar_search_freebusy", { time_min: "2026-01-01T00:00:00Z" });
    expect(textOf(missingMax).toLowerCase()).toContain("time_max");
  });

  it("deletes an event after confirming it exists", async () => {
    const methods: string[] = [];
    const { fetch } = recordingFetch((hit) => {
      methods.push(hit.method);
      if (hit.method === "GET") {
        return jsonResponse({ id: "evt123", summary: "Gone" });
      }
      return new Response(null, { status: 204 });
    });
    const text = textOf(await callTool(testCtx({ token: liveToken(), fetch }), "calendar_delete_event", { event_id: "evt123" }));
    expect(methods).toEqual(["GET", "DELETE"]);
    expect(text).toBe("Successfully deleted event (ID: evt123) from calendar 'primary' for test@example.com.");
  });

  it("requires event_id to delete and fails closed when the event is missing", async () => {
    const missing = await callTool(testCtx({ token: liveToken() }), "calendar_delete_event", {});
    expect(textOf(missing).toLowerCase()).toContain("event_id");
    const { fetch } = recordingFetch(() => jsonResponse({ error: { code: 404, message: "Not Found", errors: [{ reason: "notFound" }] } }, 404));
    const gone = await callTool(testCtx({ token: liveToken(), fetch }), "calendar_delete_event", { event_id: "missing" });
    expect(gone.isError).toBe(true);
    expect(textOf(gone)).toContain("Event not found");
  });

  it("fails auth when no google token is stored", async () => {
    const result = await callTool(testCtx(), "calendar_list_events", {});
    expect(result.isError).toBe(true);
    const lower = textOf(result).toLowerCase();
    expect(lower.includes("credentials") || lower.includes("authenticating") || lower.includes("token")).toBe(true);
  });
});
