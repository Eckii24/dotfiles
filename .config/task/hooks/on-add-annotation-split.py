#!/usr/bin/env python3
"""
Taskwarrior on-add hook.
Splits description on " :: " and moves everything after the first
occurrence into an annotation, e.g.:

  task add Rechnung pruefen :: https://example.com/invoice/123

becomes description "Rechnung pruefen" with annotation
"https://example.com/invoice/123".

Note: "--" cannot be used as separator, Taskwarrior's CLI reserves it
and strips everything after it before the hook ever sees it.
"""
import sys
import json
import time

SEP = " :: "

line = sys.stdin.readline()
task = json.loads(line)

desc = task.get("description", "")
if SEP in desc:
    description, annotation = desc.split(SEP, 1)
    task["description"] = description.strip()
    annotations = task.get("annotations", [])
    annotations.append({
        "entry": time.strftime("%Y%m%dT%H%M%SZ", time.gmtime()),
        "description": annotation.strip(),
    })
    task["annotations"] = annotations

print(json.dumps(task))
sys.exit(0)
