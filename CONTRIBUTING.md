# Contributing

CC-Web is a small local-first Node.js project. Keep changes scoped and verify them with the regression script before submitting.

## Development

```bash
npm install
npm run check
npm run regression
```

Use `npm test` to run both checks together.

## Change Guidelines

- Keep runtime-local data out of git.
- Update both `README.md` and `README.en.md` when behavior or configuration changes.
- Add or update regression coverage for agent runtime, command handling, auth, attachment, and session persistence changes.
- Prefer narrow changes over broad refactors. If a refactor is needed, keep behavior-preserving commits separate from behavior changes.
- Do not introduce new network calls in the frontend unless they are documented and have a fallback path.

## Pull Request Checklist

- `npm test` passes.
- New environment variables are documented in `.env.example`.
- New runtime files are covered by `.gitignore`.
- Security-sensitive behavior is documented in `SECURITY.md` or the README.
