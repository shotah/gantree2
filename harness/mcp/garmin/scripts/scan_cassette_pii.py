#!/usr/bin/env python3
"""Scan VCR cassettes for residual PII."""
from __future__ import annotations

import re
from pathlib import Path

ROOT = Path("testdata/cassettes")

emails: set[str] = set()
locations: set[str] = set()
uuids: set[str] = set()
names: set[str] = set()
display_names: set[str] = set()
serials: set[str] = set()
url_uuids: list[str] = []
auth_leaks: list[str] = []

uuid_re = re.compile(
    r"[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}"
)

for path in sorted(ROOT.glob("*.yaml")):
    text = path.read_text(encoding="utf-8", errors="ignore")
    emails.update(re.findall(r'"email"\s*:\s*"([^"]+)"', text))
    emails.update(
        re.findall(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}", text)
    )
    locations.update(re.findall(r'"location"\s*:\s*"([^"]+)"', text))
    display_names.update(re.findall(r'"displayName"\s*:\s*"([^"]+)"', text))
    serials.update(re.findall(r'"serialNumber"\s*:\s*"([^"]+)"', text))
    for key in ("activityName", "workoutName", "courseName", "fullName", "userName"):
        names.update(re.findall(rf'"{key}"\s*:\s*"([^"]{{1,120}})"', text))
    uuids.update(uuid_re.findall(text))
    for m in re.finditer(r"^\s*url:\s*(.+)$", text, re.M):
        url = m.group(1).strip()
        if uuid_re.search(url):
            url_uuids.append(f"{path.name}: {url}")
    for m in re.finditer(r"Authorization:\s*\n\s*-\s*(.+)", text):
        val = m.group(1).strip().strip("'\"")
        if val and val != "[REDACTED]":
            auth_leaks.append(f"{path.name}: Authorization={val[:40]}")

print("EMAILS:")
for e in sorted(emails):
    print(f"  {e}")
print("\nDISPLAY NAMES:")
for e in sorted(display_names):
    print(f"  {e}")
print("\nLOCATIONS:")
for e in sorted(locations):
    print(f"  {e}")
print("\nSERIALS:")
for e in sorted(serials):
    print(f"  {e}")
print("\nUUIDS:")
for e in sorted(uuids):
    print(f"  {e}")
print("\nURLS WITH UUID:")
for e in url_uuids:
    print(f"  {e}")
print("\nAUTH HEADER LEAKS:")
for e in auth_leaks or ["  (none)"]:
    print(e if e.startswith(" ") else f"  {e}")
print("\nNAME-LIKE FIELDS (sample):")
for e in sorted(names)[:50]:
    print(f"  {e}")
print(f"\nTotal name-like distinct values: {len(names)}")
