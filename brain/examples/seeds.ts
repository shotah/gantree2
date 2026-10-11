export type Seed = {
  id: string;
  title: string;
  /** Required prefixes or builtin names. Empty means harness builtins — always eligible. */
  servers: string[];
  steps: string[];
};

export const defaultSeeds: Seed[] = [
  {
    id: "first-aim",
    title: "First aim: pick a months-scale north-star, store it, and put a wake on the calendar",
    servers: [],
    steps: [
      "Ask one months-scale question (what should we be aiming at for the next few months?) — do not invent an aim",
      "After they answer: self_note the north-star sentence and memory_store insight subject aim/<area>",
      "Offer to cron_schedule a wake that would move that aim (daily/weekly; live-data jobs name the tools)",
    ],
  },
  {
    id: "cron-reminder",
    title: "Cron: a reminder that survives this chat — later today or every weekday",
    servers: [],
    steps: [
      "Pick something they actually forget (timecard, meds, a weekly review)",
      "cron_schedule it (once or daily) with a prompt that says what to do when it fires",
      "Work-only jobs can reply [silent]; otherwise they get the reminder in this chat",
    ],
  },
  {
    id: "memory-skill",
    title: "Memory: save a fiddly recipe as skill/<area> so you stop re-teaching it",
    servers: [],
    steps: [
      "Name one annoying workflow (how they like mail labeled, how they log training)",
      "memory_store kind=insight or fact, subject skill/<area>, with exact names and one pitfall",
      "Next time that area comes up, memory_recall skill/<area> before guessing",
    ],
  },
  {
    id: "mcp-enable",
    title: "mcp_enable: turn on a tool prefix for this chat instead of carrying 150 schemas every turn",
    servers: [],
    steps: [
      "Look at [mcp prefixes] / /tools for something that's mounted but not in this turn's list",
      "mcp_enable that prefix (short ~27h or brief ~6h)",
      "Then actually use a tool from it in the next step",
    ],
  },
  {
    id: "google-calendar-contact",
    title: "Calendar: look up a contact, check free/busy, schedule an event",
    servers: ["google"],
    steps: [
      "Find the contact in Google Contacts / people search",
      "Check calendar free/busy for a sensible slot",
      "Create a calendar event with that contact",
    ],
  },
  {
    id: "google-gmail-today-tasks",
    title: "Inbox triage: today's mail into a task list",
    servers: ["google"],
    steps: [
      "Search Gmail for today's messages",
      "Pull a couple of important threads",
      "Create tasks for anything that needs follow-up",
    ],
  },
  {
    id: "google-sheets-track",
    title: "Sheets: log a quick tracking row",
    servers: ["google"],
    steps: [
      "Open or find the tracking spreadsheet",
      "Append a dated row with what you want remembered",
      "Confirm the update",
    ],
  },
  {
    id: "morning-brief",
    title: "Daily morning brief: calendar + mail, then schedule it as a recurring reminder",
    servers: ["google"],
    steps: [
      "List today's Google Calendar events",
      "Search Gmail for anything urgent from the last day",
      "Deliver a short morning brief (agenda + must-reads)",
      "Offer to cron_schedule it daily at a morning time they choose",
    ],
  },
  {
    id: "morning-brief-ghealth",
    title: "Daily morning brief with Google Health: sleep/recovery + calendar + mail",
    servers: ["google", "ghealth"],
    steps: [
      "Pull last night's sleep via ghealth__sleep_get (wake-up day)",
      "List today's Google Calendar + skim urgent Gmail",
      "Brief: recovery note + agenda + must-reads",
      "Offer to cron_schedule this as a daily morning reminder",
    ],
  },
  {
    id: "morning-brief-garmin",
    title: "Daily morning brief with Garmin: sleep/recovery + calendar + mail",
    servers: ["google", "garmin"],
    steps: [
      "Pull last night's sleep via garmin__sleep_get (wake-up day)",
      "List today's Google Calendar + skim urgent Gmail",
      "Brief: recovery note + agenda + must-reads",
      "Offer to cron_schedule this as a daily morning reminder",
    ],
  },
  {
    id: "evening-winddown",
    title: "Evening wind-down: tomorrow's calendar, open loops, quiet close",
    servers: ["google"],
    steps: [
      "List tomorrow's Google Calendar events",
      "Scan open Google Tasks / leftover mail that still needs a decision",
      "Deliver a short wind-down: what's next, what can wait",
      "Offer to cron_schedule it daily at an evening time they choose",
    ],
  },
  {
    id: "search-calendar-event",
    title: "Web search → calendar: put a real place/event on the calendar",
    servers: ["web_search", "google"],
    steps: [
      "Search the web for the place or event details",
      "Create a Google Calendar event with the useful bits",
    ],
  },
  {
    id: "housing-sheets",
    title: "Housing scout: search listings, compile into Sheets, notify when done",
    servers: ["web_search", "rentals", "google"],
    steps: [
      "Clarify neighborhood / budget constraints",
      "Search rentals for matching listings",
      "Write the best options into a Google Sheet",
      "Tell the human the sheet is ready",
    ],
  },
  {
    id: "flights-calendar",
    title: "Flights: search options and hold a travel block on the calendar",
    servers: ["flights", "google"],
    steps: [
      "Resolve airports if needed",
      "Search flight offers for the trip",
      "Block the travel window on Google Calendar (no ticket purchase)",
    ],
  },
  {
    id: "weekly-training-strava",
    title: "Weekly training summary: roll up Strava, then schedule a Sunday reminder",
    servers: ["strava"],
    steps: [
      "List this week's Strava activities",
      "Pull athlete stats / zones as needed",
      "Write a short weekly training summary (volume, highlights, one suggestion)",
      "Offer to cron_schedule it weekly (e.g. Sunday evening)",
    ],
  },
  {
    id: "weekly-training-ghealth",
    title: "Weekly training summary: Strava load + Google Health recovery",
    servers: ["strava", "ghealth"],
    steps: [
      "List this week's Strava activities and stats",
      "Pull recent ghealth sleep / HRV / weight for recovery context",
      "Summarize load vs recovery for the week",
      "Offer to cron_schedule a weekly training summary reminder",
    ],
  },
  {
    id: "weekly-training-garmin",
    title: "Weekly training summary: Strava load + Garmin recovery",
    servers: ["strava", "garmin"],
    steps: [
      "List this week's Strava activities and stats",
      "Pull recent Garmin sleep / body battery / readiness",
      "Summarize load vs recovery for the week",
      "Offer to cron_schedule a weekly training summary reminder",
    ],
  },
  {
    id: "garmin-strava-enrich",
    title: "Enrich Strava: pull Garmin workout detail and update the Strava activity description",
    servers: ["garmin", "strava"],
    steps: [
      "Find the matching recent activity on Garmin and Strava",
      "Pull Garmin activity detail (laps, HR, notes-worthy stats)",
      "Draft a rich description from that detail",
      "Update the Strava activity description via strava__activities_update",
    ],
  },
  {
    id: "ghealth-strava-enrich",
    title: "Enrich Strava: pull Google Health workout detail and update the Strava description",
    servers: ["ghealth", "strava"],
    steps: [
      "Find the matching recent activity on Google Health and Strava",
      "Pull ghealth__activities_get detail for the session",
      "Draft a rich description from that detail",
      "Update the Strava activity description via strava__activities_update",
    ],
  },
  {
    id: "fitness-recovery-ghealth",
    title: "Training check: yesterday's Strava + last night's Google Health recovery",
    servers: ["strava", "ghealth"],
    steps: [
      "List yesterday's Strava activities",
      "Pull ghealth sleep / HRV for last night",
      "Summarize load vs recovery in plain language",
    ],
  },
  {
    id: "fitness-recovery-garmin",
    title: "Training check: yesterday's Strava + last night's Garmin recovery",
    servers: ["strava", "garmin"],
    steps: [
      "List yesterday's Strava activities",
      "Pull Garmin sleep / recovery for last night",
      "Summarize load vs recovery in plain language",
    ],
  },
  {
    id: "ghealth-sleep",
    title: "Sleep: pull last night's Google Health sleep and interpret it",
    servers: ["ghealth"],
    steps: [
      "Call ghealth__sleep_get for the wake-up day",
      "Summarize duration, stages, and one actionable takeaway",
    ],
  },
  {
    id: "garmin-sleep",
    title: "Sleep: pull last night's Garmin sleep and interpret it",
    servers: ["garmin"],
    steps: [
      "Call garmin__sleep_get for the wake-up day",
      "Summarize duration, stages, and one actionable takeaway",
    ],
  },
  {
    id: "cars-search",
    title: "Cars: search inventory and hand off the best listing URLs",
    servers: ["cars"],
    steps: [
      "Search for-sale listings by zip/make/model",
      "Pull detail on the top matches",
      "Share listing links — do not submit dealer leads",
    ],
  },
  {
    id: "math-sheets",
    title: "Numbers: compute with math tools, then log the result in Sheets",
    servers: ["math", "google"],
    steps: [
      "Evaluate the calculation with the math MCP (no mental arithmetic)",
      "Append the inputs + result to a Google Sheet row",
    ],
  },
  {
    id: "feeds-nws-watch",
    title: "RSS watch: subscribe to a feed (NWS alerts, a blog, a GitHub release) and get a text when something posts",
    servers: ["feeds"],
    steps: [
      "Resolve the feed URL with feeds__source_resolve (NWS zone, site, or GitHub repo)",
      "Offer to watch_add feeds__items_list with that url (interval 15m is fine)",
      "Explain quiet ticks stay silent; a new item can Push or [silent] if it's noise",
    ],
  },
  {
    id: "twitter-watch",
    title: "X watch: subscribe to a public account and get a text when they post",
    servers: ["twitter"],
    steps: [
      "Confirm the @handle they care about",
      "Offer to watch_add twitter__posts_list with that handle (prefer 30–60m — X reads are pay-per-use)",
      "Explain the first poll seeds the cursor (no backlog dump); [silent] still skips noise",
    ],
  },
  {
    id: "maps-near-me",
    title: "Near me: GPS + place search",
    servers: ["maps"],
    steps: [
      "If [location] is missing, ask them to send with GPS on (pendant) or a Telegram location",
      "Call maps__place_search from those coords — do not invent a city",
      "Share the Maps URL and a short pick; don't invent hours or ratings",
    ],
  },
  {
    id: "maps-route-eta",
    title: "Directions: GPS origin to a place, with a leave-by time",
    servers: ["maps"],
    steps: [
      "Use [location] as origin, or ask for GPS if it's missing",
      "Resolve the destination (maps__place_resolve or maps__link_resolve for a share link)",
      "Call maps__route_eta (bike → mode=bicycling) and include the Maps URL",
    ],
  },
  {
    id: "image-photo-generate",
    title: "Draw: turn a prompt into a PNG in this chat",
    servers: ["image"],
    steps: [
      "If image is off, mcp_enable image then call",
      "Call image__photo_generate with a specific prompt (subject, style, composition)",
      "Do not describe the picture instead of calling — the host sends the PNG to chat",
    ],
  },
  {
    id: "math-eval",
    title: "Numbers: let the math tool do the arithmetic (no mental math)",
    servers: ["math"],
    steps: [
      "State the real numbers (split a bill, a pace, a percent)",
      "Call math__expression_evaluate — don't guess the result",
      "Give the answer in one sentence",
    ],
  },
  {
    id: "search-decide",
    title: "Web search: look up a real decision, then cite what came back",
    servers: ["web_search"],
    steps: [
      "web_search the thing they need to decide",
      "Summarize what the tool returned — don't invent extra sources",
      "Offer one next step (calendar block, a task, or just the answer)",
    ],
  },
  {
    id: "commute-to-event",
    title: "Leave-by: next calendar event plus a route from GPS",
    servers: ["google", "maps"],
    steps: [
      "List today's Google Calendar and pick the next place they have to be",
      "Use [location] as origin (ask for GPS if it's missing)",
      "maps__route_eta to that place and tell them when to leave",
    ],
  },
  {
    id: "garmin-deadman",
    title: "Quiet health check: daily Garmin pull that stays [silent] when you're fine",
    servers: ["garmin"],
    steps: [
      "Pull last night's garmin__sleep_get / recovery",
      "If all-clear, reply [silent] — no pep talk",
      "Offer to cron_schedule this at a morning hour they choose (prompt must say [silent] unless something is off)",
    ],
  },
  {
    id: "ghealth-deadman",
    title: "Quiet health check: daily Google Health pull that stays [silent] when you're fine",
    servers: ["ghealth"],
    steps: [
      "Pull last night's ghealth__sleep_get / recovery",
      "If all-clear, reply [silent] — no pep talk",
      "Offer to cron_schedule this at a morning hour they choose (prompt must say [silent] unless something is off)",
    ],
  },
  {
    id: "google-week-board",
    title: "This week: calendar + tasks, what's slipping",
    servers: ["google"],
    steps: [
      "List the next 7 days of Google Calendar",
      "List open Google Tasks",
      "Two sentences: what's packed, what has no time block",
    ],
  },
  {
    id: "strava-last",
    title: "Last session: recap the most recent Strava activity",
    servers: ["strava"],
    steps: [
      "List recent Strava activities and pick the latest",
      "Summarize distance/time/effort in plain language — only numbers the tool returned",
    ],
  },
  {
    id: "search-place-maps",
    title: "Find a place on the web, then a route from GPS",
    servers: ["web_search", "maps"],
    steps: [
      "Search for the place or venue they named",
      "If [location] is missing, ask them to send with GPS",
      "maps__route_eta and share the Maps URL",
    ],
  },
];

export type NamedTool = { name: string };

export const noMatchMessage = "No multi-step recipes match your connected tools right now. Try /tools to see what's available.";

export const offHint = "Turn these off anytime with /examples off";

/** Prefix before `__`, plus unprefixed builtin names (`web_search`, `memory_store`). */
export function serverPrefixes(defs: NamedTool[]): Set<string> {
  const out = new Set<string>();
  for (const def of defs) {
    const name = def.name.trim();
    if (!name) continue;
    const cut = name.indexOf("__");
    if (cut > 0) out.add(name.slice(0, cut));
    else out.add(name);
  }
  return out;
}

/** Seeds whose required servers are all live. An empty server list is always eligible. */
export function eligible(seeds: Seed[], live: Set<string> | null): Seed[] {
  if (seeds.length === 0) return [];
  const have = live ?? new Set<string>();
  return seeds.filter((seed) => seedOk(seed, have));
}

function seedOk(seed: Seed, live: Set<string>): boolean {
  if (seed.servers.length === 0) return true;
  return seed.servers.every((server) => live.has(server));
}

export function pick(defs: NamedTool[] | null): Seed | null {
  return pickFrom(defaultSeeds, defs);
}

export function pickFrom(seeds: Seed[], defs: NamedTool[] | null): Seed | null {
  const list = eligible(seeds, serverPrefixes(defs ?? []));
  if (list.length === 0) return null;
  if (list.length === 1) return list[0] ?? null;
  const i = Math.floor(Math.random() * list.length);
  return list[i] ?? null;
}

/** Ask the model to localize a seed into a short invitation. No tools on this turn. */
export function polishPrompt(seed: Seed): string {
  const steps = seed.steps.map((step, i) => `${i + 1}. ${step}`).join("\n");
  return [
    "Propose one concrete capability example for this human based on this recipe.",
    `Title: ${seed.title}`,
    "Steps:",
    steps,
    "",
    "Rules: 2–3 sentences. Localize with a plausible everyday scenario. Invite them to try it (e.g. want me to do that?). If the recipe mentions cron_schedule / a recurring reminder, pitch scheduling it (daily or weekly) — still propose only. If the recipe mentions watch_add / a feed or X subscription, pitch setting up the watch — still propose only. If the recipe mentions GPS or [location], mention sending with GPS from the phone. If the recipe mentions self_note / a north-star / aim/, pitch setting a first months-scale aim — still propose only. If the recipe mentions mcp_enable, mention turning a prefix on for this chat. Do not call tools. Do not invent tools outside this recipe. End with a short note: " + offHint,
  ].join("\n");
}

/** Seed text when the completer fails. */
export function fallbackFormat(seed: Seed): string {
  const steps = seed.steps.map((step, i) => `${i + 1}. ${step}`).join("\n");
  return `${seed.title}\n${steps}\n\nWant me to try that?\n${offHint}`;
}
