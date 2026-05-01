import json
import re
import subprocess
import sys

try:
    import yaml
except Exception as exc:
    print(json.dumps({"ok": False, "error": "Hermes WSL 缺少 PyYAML: " + str(exc)}, ensure_ascii=False))
    raise SystemExit(0)

cfg_path = sys.argv[1]
cli_path = sys.argv[2] if len(sys.argv) > 2 else ""


def clean(value):
    return str(value or "").strip()


def slug(value):
    return re.sub(r"[^a-z0-9]+", "-", clean(value).lower()).strip("-")


try:
    with open(cfg_path, encoding="utf-8") as f:
        cfg = yaml.safe_load(f) or {}
except Exception as exc:
    print(json.dumps({"ok": False, "error": "读取 Hermes config.yaml 失败: " + str(exc)}, ensure_ascii=False))
    raise SystemExit(0)

model = cfg.get("model") if isinstance(cfg.get("model"), dict) else {}
current_model = clean(model.get("default") or model.get("model"))
current_provider = clean(model.get("provider"))
current_base = clean(model.get("base_url")).rstrip("/")
custom = cfg.get("custom_providers")
custom = custom if isinstance(custom, list) else []

providers = []
current_id = ""
for idx, entry in enumerate(custom):
    if not isinstance(entry, dict):
        continue
    name = clean(entry.get("name"))
    base_url = clean(entry.get("base_url") or entry.get("url") or entry.get("api")).rstrip("/")
    model_name = clean(entry.get("model") or entry.get("default_model"))
    if not name or not base_url or not model_name:
        continue
    provider_key = clean(entry.get("provider_key"))
    provider_slug = slug(provider_key or name)
    is_current = (
        current_model == model_name and (
            (provider_key and current_provider == provider_key)
            or current_provider in {name, provider_slug, "custom:" + provider_slug}
            or (current_provider == "custom" and current_base == base_url)
        )
    )
    row = {
        "id": "hermes-custom:" + str(idx),
        "name": name + " · " + model_name,
        "apiUrl": base_url,
        "current": bool(is_current),
        "model": model_name,
        "providerKey": provider_key,
        "apiMode": clean(entry.get("api_mode")),
    }
    providers.append(row)
    if is_current:
        current_id = row["id"]

if not current_id and (current_provider or current_model):
    current_id = "hermes-current"
    providers.insert(0, {
        "id": current_id,
        "name": (current_provider or "Hermes") + ((" · " + current_model) if current_model else ""),
        "apiUrl": current_base,
        "current": True,
        "readonly": True,
        "model": current_model,
    })

tool = {"ok": False, "label": "Hermes", "status": "未检测", "version": ""}
if cli_path:
    try:
        out = subprocess.run([cli_path, "--version"], capture_output=True, text=True, timeout=5)
        text = (out.stdout or out.stderr or "").strip().splitlines()[0] if (out.stdout or out.stderr) else ""
        tool = {
            "ok": out.returncode == 0,
            "label": "Hermes",
            "status": ("ok (" + text + ")") if out.returncode == 0 and text else ("error (" + str(out.returncode) + ")"),
            "version": text,
        }
    except Exception as exc:
        tool = {"ok": False, "label": "Hermes", "status": "error (" + str(exc) + ")", "version": ""}

current = next((p for p in providers if p.get("current")), None)
print(json.dumps({
    "ok": True,
    "app": "hermes",
    "providers": providers,
    "currentProviderId": current_id,
    "currentProviderName": current.get("name", "") if current else "",
    "currentProviderApiUrl": current.get("apiUrl", "") if current else "",
    "envStatus": {"ok": True, "app": "hermes", "summary": "Hermes config.yaml 已识别", "output": cfg_path},
    "toolStatus": tool,
}, ensure_ascii=False))
