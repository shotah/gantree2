#!/usr/bin/env python3
import json
import urllib.error
import urllib.request
from pathlib import Path

s = json.loads(Path("settings.json").read_text())
token = s["oauth2_access_token"]
domain = s.get("domain", "garmin.com")
base = f"https://connectapi.{domain}"


def req(method, path, body=None):
    data = None if body is None else json.dumps(body).encode()
    r = urllib.request.Request(
        base + path,
        data=data,
        method=method,
        headers={
            "Authorization": f"Bearer {token}",
            "User-Agent": "GCM-iOS-5.19.1.2",
            "nk": "NT",
            "Content-Type": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(r, timeout=20) as resp:
            print(method, resp.status, path, resp.read()[:280].decode())
    except urllib.error.HTTPError as e:
        print(method, e.code, path, e.read()[:220].decode(errors="replace"))


for b in (
    [1],
    [{"behaviourId": 1}],
    [{"behaviourId": 1, "tracked": True}],
    {"behaviourIds": [1]},
    {"trackedBehaviourIds": [1]},
):
    req("PUT", "/lifestylelogging-service/trackedBehaviours", b)

for b in (
    [{"behaviourId": 1, "logStatus": "YES"}],
    {"entries": [{"behaviourId": 1, "logStatus": "YES"}]},
    {"dailyLogs": [{"behaviourId": 1, "logStatus": "YES"}]},
    {"calendarDate": "2026-07-14", "entries": [{"behaviourId": 1, "logStatus": "YES"}]},
    {
        "calendarDate": "2026-07-14",
        "dailyLogsReport": [{"behaviourId": 1, "logStatus": "YES"}],
    },
):
    req("PUT", "/lifestylelogging-service/dailyLog/2026-07-14/entries", b)
    req("PUT", "/lifestylelogging-service/dailyLog/entries", b)
