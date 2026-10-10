#!/usr/bin/env python3
"""Probe lifestyle logging write candidates (read-only discovery + tiny PUT trials)."""
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
            print(method, resp.status, path, raw[:180])
            return resp.status, raw
    except urllib.error.HTTPError as e:
        raw = e.read()
        print(method, e.code, path, raw[:180])
        return e.code, raw


# Full GET
status, raw = req("GET", "/lifestylelogging-service/dailyLog/2026-07-14")
print("---")
# Candidate writes (no-op-ish: set Alcohol to NO without details)
candidates = [
    ("PUT", "/lifestylelogging-service/dailyLog/2026-07-14", {
        "calendarDate": "2026-07-14",
        "dailyLogs": [{"behaviourId": 1, "logStatus": "NO"}],
    }),
    ("POST", "/lifestylelogging-service/dailyLog", {
        "calendarDate": "2026-07-14",
        "dailyLogs": [{"behaviourId": 1, "logStatus": "NO"}],
    }),
    ("PUT", "/lifestylelogging-service/dailyLog", {
        "calendarDate": "2026-07-14",
        "behaviours": [{"behaviourId": 1, "logStatus": "NO"}],
    }),
    ("POST", "/lifestylelogging-service/log", {
        "calendarDate": "2026-07-14",
        "behaviourId": 1,
        "logStatus": "NO",
    }),
]
for method, path, body in candidates:
    req(method, path, body)
    print("---")
