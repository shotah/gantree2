#!/usr/bin/env python3
import json
import re
from pathlib import Path

text = Path("testdata/cassettes/usersummary.yaml").read_text(encoding="utf-8")
bodies = []
for m in re.finditer(r"(?m)^\s+body:\s+'(.*)'\s*$", text):
    raw = m.group(1).encode("utf-8").decode("unicode_escape")
    try:
        bodies.append(json.loads(raw))
    except Exception:
        bodies.append(None)

# 2 hydration, 4 steps weekly, 5 stress daily
for idx in (2, 4, 5, 6):
    data = bodies[idx]
    print(f"\n=== body {idx} ===")
    print(json.dumps(data if not isinstance(data, list) else data[:2], indent=2)[:1200])
