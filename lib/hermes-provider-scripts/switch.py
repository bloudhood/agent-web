import json
import shutil
import sys

try:
    import yaml
except Exception as exc:
    print(json.dumps({"ok": False, "error": "Hermes WSL 缺少 PyYAML: " + str(exc)}, ensure_ascii=False))
    raise SystemExit(0)

cfg_path = sys.argv[1]
provider_id = sys.argv[2] if len(sys.argv) > 2 else ""
if not provider_id.startswith("hermes-custom:"):
    print(json.dumps({"ok": False, "error": "只能切换 Hermes custom_providers 中的 provider"}, ensure_ascii=False))
    raise SystemExit(0)

try:
    index = int(provider_id.split(":", 1)[1])
except Exception:
    print(json.dumps({"ok": False, "error": "无效的 Hermes providerId"}, ensure_ascii=False))
    raise SystemExit(0)

try:
    with open(cfg_path, encoding="utf-8") as f:
        cfg = yaml.safe_load(f) or {}
except Exception as exc:
    print(json.dumps({"ok": False, "error": "读取 Hermes config.yaml 失败: " + str(exc)}, ensure_ascii=False))
    raise SystemExit(0)

custom = cfg.get("custom_providers")
if not isinstance(custom, list) or index < 0 or index >= len(custom) or not isinstance(custom[index], dict):
    print(json.dumps({"ok": False, "error": "未找到 Hermes provider"}, ensure_ascii=False))
    raise SystemExit(0)

entry = custom[index]
name = str(entry.get("name") or "").strip()
base_url = str(entry.get("base_url") or entry.get("url") or entry.get("api") or "").strip().rstrip("/")
model_name = str(entry.get("model") or entry.get("default_model") or "").strip()
if not name or not base_url or not model_name:
    print(json.dumps({"ok": False, "error": "Hermes provider 缺少 name/base_url/model"}, ensure_ascii=False))
    raise SystemExit(0)

model = cfg.get("model") if isinstance(cfg.get("model"), dict) else {}
cfg["model"] = model
model["default"] = model_name
provider_key = str(entry.get("provider_key") or "").strip()
if provider_key:
    model["provider"] = provider_key
    model.pop("base_url", None)
    model.pop("api_key", None)
else:
    model["provider"] = "custom"
    model["base_url"] = base_url
    api_key = str(entry.get("api_key") or "").strip()
    key_env = str(entry.get("key_env") or "").strip()
    if api_key:
        model["api_key"] = api_key
    elif key_env:
        model["api_key"] = "${" + key_env + "}"
    else:
        model.pop("api_key", None)

api_mode = str(entry.get("api_mode") or "").strip()
if api_mode:
    model["api_mode"] = api_mode
else:
    model.pop("api_mode", None)

try:
    shutil.copy2(cfg_path, cfg_path + ".cc-web-bak")
except Exception:
    pass

try:
    with open(cfg_path, "w", encoding="utf-8") as f:
        yaml.safe_dump(cfg, f, allow_unicode=True, sort_keys=False)
except Exception as exc:
    print(json.dumps({"ok": False, "error": "写入 Hermes config.yaml 失败: " + str(exc)}, ensure_ascii=False))
    raise SystemExit(0)

print(json.dumps({"ok": True, "providerName": name + " · " + model_name, "providerId": provider_id}, ensure_ascii=False))
