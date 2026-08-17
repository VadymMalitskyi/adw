#!/usr/bin/env bash
# Container-owned Claude Code status line. Claude supplies the JSON payload on
# stdin; keep this script local so no host config, paths, or session state are
# exposed to the managed container.
set -euo pipefail

python3 -c '
import datetime
import json
import subprocess
import sys

try:
    data = json.load(sys.stdin)
except (json.JSONDecodeError, OSError):
    print("context: unavailable")
    raise SystemExit

def compact(value):
    value = int(value or 0)
    return f"{value // 1000}k" if value >= 1000 else str(value)

context = data.get("context_window") or {}
used = context.get("used_percentage")
context_text = f"context: {int(used)}%" if used not in (None, "") else "context: unavailable"

model = data.get("model") or {}
model_name = model.get("display_name", "") if isinstance(model, dict) else str(model)
effort = ((data.get("effort") or {}).get("level", ""))
if model_name and effort:
    model_name = f"{model_name} ({effort})"

rate = ((data.get("rate_limits") or {}).get("five_hour") or {})
rate_used = rate.get("used_percentage")
rate_text = ""
if rate_used not in (None, ""):
    rate_text = f"5h: {int(rate_used)}%"
    if rate.get("resets_at"):
        rate_text += " (resets " + datetime.datetime.fromtimestamp(rate["resets_at"]).strftime("%H:%M") + ")"

total_input = compact(context.get("total_input_tokens"))
total_output = compact(context.get("total_output_tokens"))
tokens = f"↑{total_input} ↓{total_output}"
try:
    branch = subprocess.check_output(["git", "branch", "--show-current"], stderr=subprocess.DEVNULL, text=True).strip()
except (OSError, subprocess.CalledProcessError):
    branch = ""

parts = [context_text]
parts.extend(part for part in (model_name, branch, rate_text, tokens) if part)
print(" │ ".join(parts))
' 
