import { describe, expect, it } from "vitest";
import { parseToolCallText, parseToolCallTextHinted } from "@/harness/provider";

describe("parseToolCallText", () => {
  const cases: { name: string; content: string; wantName: string; wantArgs: string }[] = [
    {
      name: "bare object with parameters key",
      content: "{\n  \"name\": \"garmin__get_daily_activity\",\n  \"parameters\": {\n    \"date\": \"2026-07-28\"\n  }\n}",
      wantName: "garmin__get_daily_activity",
      wantArgs: "2026-07-28",
    },
    {
      name: "arguments key",
      content: "{\"name\":\"garmin__hrv_get\",\"arguments\":{\"date\":\"2026-07-27\"}}",
      wantName: "garmin__hrv_get",
      wantArgs: "2026-07-27",
    },
    {
      name: "stringified arguments",
      content: "{\"name\":\"garmin__hrv_get\",\"arguments\":\"{\\\"date\\\":\\\"2026-07-27\\\"}\"}",
      wantName: "garmin__hrv_get",
      wantArgs: "2026-07-27",
    },
    {
      name: "markdown fence",
      content: "```json\n{\"name\":\"garmin__hrv_get\",\"parameters\":{}}\n```",
      wantName: "garmin__hrv_get",
      wantArgs: "{}",
    },
    {
      name: "tool_call tags",
      content: "<tool_call>\n{\"name\": \"math__expression_evaluate\", \"arguments\": {\"expr\": \"2+2\"}}\n</tool_call>",
      wantName: "math__expression_evaluate",
      wantArgs: "2+2",
    },
    {
      name: "embedded in prose",
      content: "Pulling that up now: {\"name\":\"garmin__sleep_get\",\"parameters\":{\"date\":\"2026-07-28\"}} — one sec.",
      wantName: "garmin__sleep_get",
      wantArgs: "2026-07-28",
    },
    {
      name: "no arguments at all still runs",
      content: "{\"name\":\"garmin__hrv_get\"}",
      wantName: "garmin__hrv_get",
      wantArgs: "{}",
    },
    {
      name: "braces inside string values",
      content: "{\"name\":\"math__expression_evaluate\",\"arguments\":{\"expr\":\"{2+2}\"}}",
      wantName: "math__expression_evaluate",
      wantArgs: "{2+2}",
    },
    {
      name: "fn-style braced kwargs",
      content: "{google__calendar_list_events(time_min=\"2026-07-29T00:00:00-07:00\", "
        + "time_max=\"2026-07-30T00:00:00-07:00\", calendar_id=\"primary\", "
        + "user_google_email=\"owner@example.com\")}",
      wantName: "google__calendar_list_events",
      wantArgs: "owner@example.com",
    },
    {
      name: "fn-style without braces",
      content: "Calling garmin__sleep_get(date=\"2026-07-29\") now.",
      wantName: "garmin__sleep_get",
      wantArgs: "2026-07-29",
    },
    {
      name: "fn-style duplicated in reply (take first)",
      content: "{google__calendar_list_events(calendar_id=\"primary\", time_min=\"2026-07-29T00:00:00-07:00\")}"
        + "\n\n"
        + "{google__calendar_list_events(calendar_id=\"primary\", time_min=\"2026-07-29T00:00:00-07:00\")}",
      wantName: "google__calendar_list_events",
      wantArgs: "primary",
    },
    {
      name: "args-only json fence with tool name nearby",
      content: "google__calendar_list_events\n```json\n"
        + "{\"calendar_id\":\"primary\",\"time_min\":\"2026-07-29T00:00:00-07:00\",\"time_max\":\"2026-07-30T00:00:00-07:00\"}"
        + "\n```",
      wantName: "google__calendar_list_events",
      wantArgs: "time_min",
    },
  ];

  for (const tc of cases) {
    it(tc.name, () => {
      const call = parseToolCallText(tc.content);
      expect(call, tc.content).toBeDefined();
      expect(call?.name).toBe(tc.wantName);
      expect(call?.arguments).toContain(tc.wantArgs);
      expect(call?.id).not.toBe("");
    });
  }

  it("rejects prose, nameless JSON, and real answers that mention a tool", () => {
    const rejected = [
      "",
      "You rode 21mi yesterday.",
      "{\"protein\":180,\"carbs\":220}",
      "{\"name\":\"\",\"arguments\":{}}",
      "{\"nickname\":\"SAM\",\"arguments\":{}}",
      "{\"name\":\"x\", \"arguments\": {oops",
      "I already used google__calendar_list_events earlier. Macros: {\"protein\":180,\"carbs\":220}",
    ];
    for (const content of rejected) {
      expect(parseToolCallText(content), content).toBeUndefined();
    }
  });

  it("salvages args-only JSON when the prior turn named the tool", () => {
    const content = "```json\n"
      + "{\"calendar_id\":\"primary\",\"time_max\":\"2026-07-30T00:00:00-07:00\",\"time_min\":\"2026-07-29T00:00:00-07:00\",\"user_google_email\":\"owner@example.com\"}"
      + "\n```";
    const call = parseToolCallTextHinted(content, ["google__calendar_list_events"]);
    expect(call?.name).toBe("google__calendar_list_events");
    expect(call?.arguments).toContain("owner@example.com");
  });

  it("gives each salvaged call its own id", () => {
    const a = parseToolCallText("{\"name\":\"garmin__hrv_get\"}");
    const b = parseToolCallText("{\"name\":\"garmin__hrv_get\"}");
    expect(a?.id).toBeTruthy();
    expect(a?.id).not.toBe(b?.id);
  });
});
