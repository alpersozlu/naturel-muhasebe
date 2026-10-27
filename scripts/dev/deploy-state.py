#!/usr/bin/env python3
"""Vercel yayın durumu (GitHub deployments API). Kullanım: python3 scripts/dev/deploy-state.py <kısa-sha>
Çıktı: none | pending | success | failure | error  (environment "7emg")."""
import json
import subprocess
import sys

GH = "/Users/alpersozlu/.local/bin/gh"
sha = sys.argv[1]
ds = json.loads(subprocess.check_output([GH, "api", "repos/alpersozlu/naturel-muhasebe/deployments?per_page=8"]))
ds = [d for d in ds if d["sha"].startswith(sha) and "7emg" in d["environment"]]
if not ds:
    print("none")
    sys.exit()
st = json.loads(subprocess.check_output([GH, "api", "repos/alpersozlu/naturel-muhasebe/deployments/%s/statuses" % ds[0]["id"]]))
print(st[0]["state"] if st else "pending")
