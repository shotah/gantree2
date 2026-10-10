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
            print(method, resp.status, path)
            print(raw[:400].decode("utf-8", "replace"))
            print("---")
            return resp.status, raw
    except urllib.error.HTTPError as e:
        raw = e.read()
        print(method, e.code, path, raw[:250])
        print("---")
        return e.code, raw


# Discovery GETs
for p in [
    "/lifestylelogging-service/behaviours",
    "/lifestylelogging-service/behaviors",
    "/lifestylelogging-service/trackedBehaviours",
    "/lifestylelogging-service/settings",
]:
    req("GET", p)

# Logging candidates with Alcohol YES + beer detail (user already has alcohol tracking)
bodies = [
    ("PUT", "/lifestylelogging-service/behaviours", {
        "calendarDate": "2026-07-14",
        "behaviourId": 1,
        "logStatus": "YES",
        "details": [{"subTypeId": 1, "subTypeName": "BEER", "amount": 1}],
    }),
    ("PUT", "/lifestylelogging-service/behaviours", [{
        "calendarDate": "2026-07-14",
        "behaviourId": 1,
        "logStatus": "YES",
        "details": [{"subTypeId": 1, "subTypeName": "BEER", "amount": 1}],
    }]),
    ("POST", "/lifestylelogging-service/dailyLog/log", {
        "calendarDate": "2026-07-14",
        "behaviourId": 1,
        "logStatus": "YES",
        "details": [{"subTypeId": 1, "subTypeName": "BEER", "amount": 1}],
    }),
    ("PUT", "/lifestylelogging-service/dailyLog/log", {
        "calendarDate": "2026-07-14",
        "behaviourId": 1,
        "logStatus": "YES",
    }),
    ("POST", "/lifestylelogging-service/logs", {
        "calendarDate": "2026-07-14",
        "behaviourId": 1,
        "logStatus": "YES",
    }),
    ("PUT", "/lifestylelogging-service/logs", {
        "calendarDate": "2026-07-14",
        "behaviourId": 1,
        "logStatus": "YES",
    }),
    ("POST", "/lifestylelogging-service/dailyLogsReport", {
        "calendarDate": "2026-07-14",
        "behaviourId": 1,
        "logStatus": "YES",
    }),
]
for m, p, b in bodies:
    req(m, p, b)
