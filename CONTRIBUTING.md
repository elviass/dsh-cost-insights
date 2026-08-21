# Contributing

Thank you for helping improve DSH Usage Insights.

## Development

Use Node.js 22.19 or 24 and pnpm 10.34.5. Keep every development profile isolated from the normal Harness home.

```powershell
pnpm install --frozen-lockfile
pnpm run check
pnpm test
pnpm run test:coverage
```

Tests must not contain real credentials, prompts, responses, session logs, or databases. Network adapters require fixture tests; run `pnpm run test:live` before a release when internet access is available.

## Pull requests

- Explain the user-visible behavior and privacy impact.
- Add tests for bug fixes and new parsing rules.
- Keep RPC method names and stored ledger compatibility unless the change includes a documented migration.
- Do not add npm publishing. This repository is distributed through GitHub Releases only.

Report security issues through GitHub private vulnerability reporting as described in [SECURITY.md](./SECURITY.md).
