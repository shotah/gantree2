# Live check

Paste one prompt into chat. Start a new thread for each prompt so a
failure in one service does not bury the next. The agent calls the
real tools. It does not invent a result.

Builtins (memory, cron, `self_note`, `web_search`, aims) have no
prefix. A plugin tool is `{plugin}__{tool}`
([mcp.md](mcp.md)). The face, wallpaper, and mood are the `chat`
plugin. They ship with the harness, so they are in the first prompt.

A skipped plugin comes back as `no_key`, `no_oauth`, `disabled`, or
`error`. That line is the result. Write it down and go on. Do not
retry a skip with a made-up name.

These prompts do not send mail, create or delete calendar events,
post, upload a workout, or change someone else's data. The harness
prompt does write: one memory, one self-note line, one reminder, and
a new face, wallpaper, and mood.

Google: if the tool does not already know the mailbox, ask whether
it is work, personal, or another address. Do not guess. Pass that
address as `user_google_email`.

Garmin has no browser login. Keys are `GARMIN_EMAIL` and
`GARMIN_PASSWORD`, then `/auth garmin` in chat. If MFA is required,
the reply is `/auth garmin <code>`.

---

## How to read the reply

The last message of each run is a list. One line per step:

```text
step — tool — ok or fail — what came back, or the exact error, or what is missing
```

A fail that says `no_oauth` or `no_key` is a setup gap, not a broken
tool. A fail that is a traceback or a wrong name is a bug. Keep both.

---

## 1. Harness

Paste this as the whole message.

```text
We are testing the harness. Do these steps in order. Track every error and every missing piece. Do not invent results. If a tool is skipped (no_key, no_oauth, disabled, error), copy that message and continue.

After the last step, reply with one line per step:
step — tool — ok or fail — the result, the exact error, or what is missing.

1. Save a memory with memory_store. kind=fact, subject=test/live-check, content= one sentence that this live check ran, including today's date.
2. Retrieve it with memory_recall query "live-check". Quote the row id and the sentence.
3. Append one short self_note line that this live check happened. If that line is already in SELF.md, say so and skip.
4. Schedule a cron reminder with cron_schedule. when is "in 10m", repeat is once, prompt is "Live check reminder. Say the check fired and stop." Then cron_list and quote the job id.
5. web_search for "gantree". If search is skipped, record the missing key.
6. Face. image__photo_generate a simple 1:1 portrait. Then chat__avatar_update with that source_path. If image or chat is skipped, record why and skip the face.
7. Wallpaper. image__photo_generate a simple 9:16 picture. Then chat__backdrop_update with that source_path. Same skip rule as the face.
8. Mood. chat__theme_list, pick one neutral dark id from that list, chat__theme_update with that id. Do not invent a hex color.

Leave the memory, the note, the cron job, the face, the wallpaper, and the mood in place. Put their ids in the report so I can undo them.
```

---

## 2. Plugins

One prompt per plugin. Same report shape as the harness prompt.
Read only, except where a step says it writes.

### Google

```text
We are testing the google plugin. Read only. Do not send mail, create or delete events, or change files.

If you do not already know which Google account, ask me: work, personal, or another. Do not guess. Use that address as user_google_email on every call.

Do these in order. If a call is skipped or errors, copy the exact message and continue. Then one line per step: step — tool — ok or fail — result, error, or what is missing.

1. google__calendar_list_events for today in my timezone. Summarize the titles and times. If the day is empty, say empty.
2. google__gmail_search_messages for mail from the last day. Summarize a few subjects only. Do not open attachments.
3. google__drive_search_files for a broad recent query. Name up to five files. Do not download them.
4. google__contacts_search for my own name, or google__contacts_list if search needs a query you do not have. Name up to five people.
```

### Garmin

```text
We are testing the garmin plugin. Read only. Do not create or change an activity.

If the tool says to sign in, stop and tell me to set GARMIN_EMAIL and GARMIN_PASSWORD and then send /auth garmin. If it wants a code, tell me to send /auth garmin and the code. Do not invent sleep numbers.

Do these in order. Copy any exact error and continue. Then one line per step: step — tool — ok or fail — result, error, or what is missing.

1. garmin__sleep_get for last night. Report the sleep score and the date.
2. garmin__hrv_get for the same day.
3. garmin__wellness_get_body_battery for the same day.
4. garmin__activities_list the most recent activities. Name up to five.
5. garmin__weight_get the latest weight.
```

### Google Health

This is not Garmin. It is the `google-health` plugin.

```text
We are testing the google-health plugin. Read only.

If you do not know which Google account, ask: work, personal, or another. Do not guess.

Do these in order. Copy any exact error and continue. Then one line per step: step — tool — ok or fail — result, error, or what is missing.

1. google-health__account_get.
2. google-health__profile_get.
3. google-health__sleep_get for last night. Report the score and the date.
4. google-health__heart_rate_get for the same day.
5. google-health__weight_get the latest weight.
```

### Strava

```text
We are testing the strava plugin. Read only. Do not create, update, or upload an activity.

If Strava is not connected, say whether the miss is no_key or no_oauth and stop that plugin.

Do these in order. Copy any exact error and continue. Then one line per step: step — tool — ok or fail — result, error, or what is missing.

1. strava__athlete_get. Report the athlete name and id.
2. strava__athlete_get_stats for that athlete.
3. strava__activities_list the most recent page. Name up to five activities.
4. strava__activities_get the first id from that list. If the list was empty, say so and skip this step.
```

### Maps

```text
We are testing the maps plugin. Read only.

Do these in order. Copy any exact error and continue. Then one line per step: step — tool — ok or fail — result, error, or what is missing.

1. maps__place_search for "Pike Place Market, Seattle".
2. maps__place_resolve the top result from that search.
3. maps__route_eta from Seattle-Tacoma Airport to that place. Report the leave-by or the duration the tool actually returned.
```

### Flights

```text
We are testing the flights plugin. Read only. Do not book.

Do these in order. Copy any exact error and continue. Then one line per step: step — tool — ok or fail — result, error, or what is missing.

1. flights__account_get.
2. flights__airports_search for "Denver".
3. flights__offers_search one-way from DEN to SEA about two weeks from today. Name up to three offers with price and stops. If the tool needs a cabin or date shape, use what its error asks for and record that.
```

### Rentals

```text
We are testing the rentals plugin. Read only.

Do these in order. Copy any exact error and continue. Then one line per step: step — tool — ok or fail — result, error, or what is missing.

1. rentals__account_get.
2. rentals__areas_resolve for "Austin, TX".
3. rentals__listings_search in that area, a small page. Name up to three listings and their rents.
```

### Feeds

```text
We are testing the feeds plugin. Read only.

Do these in order. Copy any exact error and continue. Then one line per step: step — tool — ok or fail — result, error, or what is missing.

1. feeds__source_resolve for "https://hnrss.org/frontpage".
2. feeds__items_list for that feed. Name up to five titles and links.
```

### Twitter

The plugin id is `twitter`. Posts, not tweets.

```text
We are testing the twitter plugin. Read only. Do not post.

Do these in order. Copy any exact error and continue. Then one line per step: step — tool — ok or fail — result, error, or what is missing.

1. twitter__posts_list for a recent public query "gantree". Name up to five posts. If the tool requires a different query field, use what the error asks for and record that.
```

### Image

```text
We are testing the image plugin.

Do these in order. Copy any exact error and continue. Then one line per step: step — tool — ok or fail — result, error, or what is missing.

1. image__photo_generate a simple 1:1 flat icon of a green check mark on a dark background. Report the source_path.
2. image__photo_edit that image: add a thin white border. Report the new source_path.

Do not set this as my face. That is chat__avatar_update, and the harness prompt does it.
```

### Math

```text
We are testing the math plugin.

Do these in order. Copy any exact error and continue. Then one line per step: step — tool — ok or fail — result, error, or what is missing.

1. math__expression_evaluate for (12 + 8) * 3. The result must be 60. If it is not, fail the step and quote both numbers.
2. math__units_convert 5 kilometers to miles. Quote the number the tool returned.
```

### Chat

Face, wallpaper, and mood. Use this when you want the `chat` plugin
without the rest of the harness prompt.

```text
We are testing the chat plugin. This changes my face, wallpaper, and mood. Leave them in place and report the ids so I can undo them.

Do these in order. Copy any exact error and continue. Then one line per step: step — tool — ok or fail — result, error, or what is missing.

1. chat__avatar_get. Report the current rev.
2. image__photo_generate a simple 1:1 portrait. chat__avatar_update with that source_path. If image is skipped, record it and skip the update.
3. image__photo_generate a simple 9:16 picture. chat__backdrop_update with that source_path.
4. chat__theme_list. Pick one neutral dark id from that list. chat__theme_update with that id. Do not invent a hex color.
```

---

## 3. All of it

One thread. The agent walks the harness, then every plugin. Same
rules: copy the error, continue, no invented numbers, no mail, no
deletes, no bookings, no uploads.

```text
We are testing the harness and every plugin in one pass. Do the blocks in order. Inside a block, do the steps in order.

Rules for the whole run:
- Do not invent results, scores, prices, or file names.
- If a tool is skipped (no_key, no_oauth, disabled, error), copy the exact message and continue to the next step.
- If you do not know which Google account, ask once: work, personal, or another. Do not guess. Reuse that address as user_google_email.
- If Garmin wants /auth garmin, tell me and continue to the next plugin. Do not invent sleep data.
- Do not send mail, create or delete calendar events, change Drive files, post, book a flight, or create or upload an activity.
- The harness block and the chat steps do write: one memory, one note, one reminder, and a new face, wallpaper, and mood. Leave them. List the ids so I can undo them.

After the last block, one line per step:
step — tool — ok or fail — the result, the exact error, or what is missing.

Harness
1. memory_store kind=fact, subject=test/live-check, content= one sentence that this full live check ran, with today's date.
2. memory_recall query "live-check". Quote the row id.
3. self_note one short line that this full check happened. Skip if that line is already in SELF.md.
4. cron_schedule when "in 10m", repeat once, prompt "Live check reminder. Say the check fired and stop." Then cron_list and quote the job id.
5. web_search "gantree".
6. aim_history. If there is no live aim, say so. Do not invent a score.

Chat and image
7. image__photo_generate a simple 1:1 portrait. chat__avatar_update with that source_path.
8. image__photo_generate a simple 9:16 picture. chat__backdrop_update with that source_path.
9. chat__theme_list, then chat__theme_update with one neutral dark id from that list.
10. image__photo_edit the portrait: add a thin white border. Do not set that edit as the face. Report the path.

Google
11. google__calendar_list_events for today.
12. google__gmail_search_messages for the last day. Subjects only.
13. google__drive_search_files. Up to five names.
14. google__contacts_list or google__contacts_search. Up to five names.

Garmin
15. garmin__sleep_get for last night. Report the sleep score.
16. garmin__hrv_get for that day.
17. garmin__wellness_get_body_battery for that day.
18. garmin__activities_list. Up to five names.
19. garmin__weight_get.

Google Health
20. google-health__sleep_get for last night.
21. google-health__heart_rate_get for that day.
22. google-health__profile_get.

Strava
23. strava__athlete_get.
24. strava__activities_list. Up to five names.
25. strava__activities_get the first id, if the list was not empty.

Maps
26. maps__place_search "Pike Place Market, Seattle".
27. maps__route_eta from Seattle-Tacoma Airport to that place.

Flights
28. flights__airports_search "Denver".
29. flights__offers_search one-way DEN to SEA about two weeks out. Up to three offers. Do not book.

Rentals
30. rentals__areas_resolve "Austin, TX".
31. rentals__listings_search there. Up to three listings.

Feeds and a watch
32. feeds__items_list for https://hnrss.org/frontpage. Up to five titles.
33. If that list returned ids, watch_add tool feeds__items_list with those args at the default interval, then watch_list and quote the watch id. If the list failed, skip the watch.

Twitter
34. twitter__posts_list query "gantree". Up to five posts. Do not post.

Math
35. math__expression_evaluate (12 + 8) * 3. Fail the step if the result is not 60.
36. math__units_convert 5 kilometers to miles.
```
