import glob
import os
import shutil

homes = [
    os.environ.get("CC_WEB_HERMES_HOME", ""),
    os.path.join(os.path.expanduser("~"), ".hermes"),
]
homes += glob.glob("/home/*/.hermes") + glob.glob("/root/.hermes")

for home in dict.fromkeys([h for h in homes if h]):
    cfg = os.path.join(home, "config.yaml")
    if not os.path.isfile(cfg):
        continue
    cli = os.environ.get("CC_WEB_HERMES_CLI", "") or shutil.which("hermes") or ""
    if not cli:
        candidates = [
            os.path.join(os.path.expanduser("~"), ".local/bin/hermes"),
            os.path.join(home, "bin/hermes"),
        ]
        candidates += glob.glob("/home/*/.local/bin/hermes")
        for candidate in candidates:
            if os.path.isfile(candidate) and os.access(candidate, os.X_OK):
                cli = candidate
                break
    print(cfg)
    print(cli)
    raise SystemExit(0)

raise SystemExit(3)
