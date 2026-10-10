#!/usr/bin/env python3
import re
from pathlib import Path

for path in Path("testdata/cassettes").glob("*.yaml"):
    text = path.read_text(encoding="utf-8", errors="ignore")
    for m in re.finditer(r"profile_images/[^\s\"\\]+", text):
        print(path.name, "img", m.group(0)[:140])
    for m in re.finditer(r'"deviceSettingsFile"\s*:\s*"[^"]+"', text):
        print(path.name, "settings", m.group(0)[:140])
