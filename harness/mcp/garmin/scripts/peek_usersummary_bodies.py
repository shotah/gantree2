#!/usr/bin/env python3
import json
import re
from pathlib import Path

text = Path("testdata/cassettes/usersummary.yaml").read_text(encoding="utf-8")
# go-vcr stores body as: body: '...' or body: "..."
for i, m in enumerate(re.finditer(r"(?m)^\s+body:\s+'(.*)'\s*$", text)):
    raw = m.group(1).encode("utf-8").decode("unicode_escape")
    try:
        data = json.loads(raw)
    except Exception as e:
        print(f"{i}: parse fail {e}: {raw[:60]}")
        continue
    if isinstance(data, dict):
        print(f"{i}: object keys ({len(data)}): {sorted(data)[:20]}")
    elif isinstance(data, list):
        keys = sorted(data[0]) if data and isinstance(data[0], dict) else []
        print(f"{i}: array len={len(data)} item_keys={keys}")
    else:
        print(f"{i}: {type(data)}")
