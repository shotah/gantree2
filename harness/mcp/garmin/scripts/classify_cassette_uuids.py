#!/usr/bin/env python3
from __future__ import annotations

import re
from collections import defaultdict
from pathlib import Path

uuid_re = re.compile(
    r"[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}"
)
ctx: dict[str, set[tuple[str, str]]] = defaultdict(set)

for path in Path("testdata/cassettes").glob("*.yaml"):
    text = path.read_text(encoding="utf-8", errors="ignore")
    for m in uuid_re.finditer(text):
        before = text[max(0, m.start() - 80) : m.start()]
        snippet = text[max(0, m.start() - 40) : m.end() + 10].replace("\n", " ")
        if "url:" in before[-40:]:
            kind = "url"
        elif '"uuid"' in before[-30:]:
            kind = "json-uuid"
        elif "jti" in before[-30:]:
            kind = "jti"
        elif "request-id" in before[-40:] or "requestId" in before[-40:]:
            kind = "request-id"
        elif "garminGUID" in before[-40:] or "garmin_guid" in before[-40:]:
            kind = "garmin-guid"
        elif "Cf-Ray" in before[-40:]:
            kind = "cf-ray"
        else:
            kind = "other"
        ctx[kind].add((path.name, snippet[:140]))

for kind, items in sorted(ctx.items()):
    print(f"## {kind} ({len(items)})")
    for name, snippet in sorted(items)[:10]:
        print(f"  {name} :: {snippet}")
    print()
