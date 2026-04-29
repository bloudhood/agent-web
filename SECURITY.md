# Security Policy

CC-Web is designed as a local or private-network control surface for local CLI agents. It can start local processes, read local CLI history, and optionally help an agent use saved GitHub/SSH configuration. Treat it as a powerful developer workstation tool, not a public SaaS app.

## Supported Use

- Run behind a private network, Tailscale, Cloudflare Tunnel, or a trusted reverse proxy with HTTPS.
- Use a strong `CC_WEB_PASSWORD` or change the generated first-login password immediately.
- Keep `config/`, `sessions/`, `logs/`, and `attachments/` private. These directories may contain local paths, prompts, tool output, and operational metadata.
- Prefer SSH key authentication over stored SSH passwords.

## Do Not

- Do not expose CC-Web directly to the public internet without an additional access layer.
- Do not commit `.env`, `config/*.json`, `sessions/`, `logs/`, `attachments/`, `.claude/`, or `.codex/`.
- Do not paste API keys into issues, screenshots, logs, or pull requests.

## Sensitive Local Files

The following files are runtime-local and intentionally ignored by git:

- `config/auth.json`
- `config/notify.json`
- `config/model.json`
- `config/codex.json`
- `config/dev.json`
- `config/banned_ips.json`
- `sessions/`
- `logs/`
- `attachments/`

## Reporting

Open a private security report if the GitHub repository enables private advisories. Otherwise, create a minimal public issue that describes impact and affected versions without exposing secrets or exploit payloads.
