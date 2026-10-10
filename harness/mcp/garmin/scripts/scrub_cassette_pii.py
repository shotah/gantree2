#!/usr/bin/env python3
"""Apply the same PII redactions as testutil sanitizeHook to existing cassettes."""
from __future__ import annotations

import re
from pathlib import Path

ZERO = "00000000-0000-0000-0000-000000000000"
ROOT = Path("testdata/cassettes")

# Use [^\n/?]+ so path scrubbing cannot span YAML lines (e.g. into "HTTP/2.0").
URL_SUBS = [
    (re.compile(r"(/usersummary-service/usersummary/daily/)[^\n/?]+"), r"\1anonymous"),
    (re.compile(r"(/wellness-service/wellness/dailySleepData/)[^\n/?]+"), r"\1anonymous"),
    (re.compile(r"(/wellness-service/wellness/dailySummaryChart/)[^\n/?]+"), r"\1anonymous"),
    (re.compile(r"(/racepredictions/(?:latest|daily|monthly)/)[^\n/?]+"), r"\1anonymous"),
    (re.compile(r"(/personalrecord-service/personalrecord/prs/)[^\n/?]+"), r"\1anonymous"),
]

BODY_SUBS = [
    (re.compile(r'"activityName"\s*:\s*"[^"]*"'), '"activityName":"Anonymous Activity"'),
    (re.compile(r'"workoutName"\s*:\s*"[^"]*"'), '"workoutName":"Anonymous Workout"'),
    (re.compile(r'"activityUUID"\s*:\s*\{\s*"uuid"\s*:\s*"[^"]*"\s*\}'), f'"activityUUID":{{"uuid":"{ZERO}"}}'),
    (re.compile(r'"activityUUID"\s*:\s*"[^"]*"'), f'"activityUUID":"{ZERO}"'),
    (re.compile(r'"uuid"\s*:\s*"[0-9a-fA-F-]{36}"'), f'"uuid":"{ZERO}"'),
    (re.compile(r'"jti"\s*:\s*"[^"]*"'), f'"jti":"{ZERO}"'),
    (re.compile(r'"consumer"\s*:\s*"[^"]*"'), f'"consumer":"{ZERO}"'),
    (
        re.compile(r"https://s3\.amazonaws\.com/garmin-connect-prod/profile_images/[^\"\\]+"),
        "https://example.com/profile.png",
    ),
    (re.compile(r'"deviceSettingsFile"\s*:\s*"[^"]*"'), '"deviceSettingsFile":"anonymous-device-settings.json"'),
]

HEADER_KEYS = ("X-Vcap-Request-Id", "X-Request-Id", "x-vcap-request-id", "x-request-id")


def scrub(text: str) -> str:
    for pat, repl in URL_SUBS:
        text = pat.sub(repl, text)
    for pat, repl in BODY_SUBS:
        text = pat.sub(repl, text)
    for key in HEADER_KEYS:
        text = re.sub(
            rf"(^[ \t]*{re.escape(key)}:[ \t]*\n[ \t]*-[ \t]*).+$",
            r"\1'[REDACTED]'",
            text,
            flags=re.M,
        )
    return text


def main() -> None:
    changed = 0
    for path in sorted(ROOT.glob("*.yaml")):
        original = path.read_text(encoding="utf-8")
        updated = scrub(original)
        if updated != original:
            path.write_text(updated, encoding="utf-8")
            changed += 1
            print(f"scrubbed {path.name}")
    print(f"updated {changed} files")


if __name__ == "__main__":
    main()
