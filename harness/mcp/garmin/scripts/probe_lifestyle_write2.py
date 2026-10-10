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
            "Accept": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(r, timeout=30) as resp:
            raw = resp.read()
            print(method, resp.status, path, raw[:200])
    except urllib.error.HTTPError as e:
        raw = e.read()
        print(method, e.code, path, raw[:200])


body = {"calendarDate": "2026-07-14", "dailyLogs": [{"behaviourId": 1, "logStatus": "NO"}]}
single = {"calendarDate": "2026-07-14", "behaviourId": 1, "logStatus": "NO"}
paths = [
    ("POST", "/lifestylelogging-service/dailyLog/2026-07-14", body),
    ("PATCH", "/lifestylelogging-service/dailyLog/2026-07-14", body),
    ("PUT", "/lifestylelogging-service/dailyLogs", body),
    ("POST", "/lifestylelogging-service/dailyLogs", body),
    ("PUT", "/lifestylelogging-service/behaviour/1", single),
    ("POST", "/lifestylelogging-service/behaviour", single),
    ("PUT", "/lifestylelogging-service/behaviours", body),
    ("POST", "/lifestylelogging-service/behaviours", body),
    ("PUT", "/lifestylelogging-service/dailyLog/2026-07-14/behaviour/1", single),
    ("POST", "/lifestylelogging-service/dailyLog/2026-07-14/behaviour/1", single),
    ("PUT", "/mct-lifestylelogging-service/dailyLog/2026-07-14", body),
    ("POST", "/connect-lifestylelogging-service/dailyLog", body),
]
for m, p, b in paths:
    req(m, p, b)
