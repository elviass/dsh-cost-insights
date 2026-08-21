# DSH Usage Insights

[![CI](https://github.com/elviass/dsh-usage-insights/actions/workflows/ci.yml/badge.svg)](https://github.com/elviass/dsh-usage-insights/actions/workflows/ci.yml)
[![CodeQL](https://github.com/elviass/dsh-usage-insights/actions/workflows/codeql.yml/badge.svg)](https://github.com/elviass/dsh-usage-insights/actions/workflows/codeql.yml)

Auditable local usage, token, cache, balance, and pricing analytics for DeepSeek Harness.

![Sanitized Usage & Cost view](https://raw.githubusercontent.com/elviass/dsh-usage-insights/v1.0.0/docs/images/usage-cost.png)

> This project is distributed only through GitHub Releases. The unscoped npm name
> `dsh-usage-insights` belongs to another publisher. Do not install it from npm and
> do not publish this repository to npm.

## Install

1. Download `dsh-usage-insights-1.0.0.tgz` and `SHA256SUMS.txt` from the
   [v1.0.0 release](https://github.com/elviass/dsh-usage-insights/releases/tag/v1.0.0).
2. Verify the archive checksum.
3. Install the local archive with the DSH plugin command for your profile:

   ```console
   dsh plugin --profile web add ./dsh-usage-insights-1.0.0.tgz
   ```

The GitHub package specifier is intentionally not documented as a shortcut until
it has passed the same two-version installation test as the release archive.

## Compatibility

- DeepSeek Harness `>=0.1.0-rc.7 <0.2.0`
- Node.js `^22.19.0 || >=24.0.0`
- Web client surface

The release candidate is tested against DSH `0.1.0-rc.7` and `0.1.1-rc.2` in
independent temporary `DSH_HOME` directories.

## What it records

The plugin records numeric usage metadata, provider/model identifiers, timestamps,
session/workspace grouping, price-source metadata, and optional balance snapshots.
It does not store prompts, responses, or raw API keys. Credential statistics only
accept explicit credential references (`credentialRef`, `apiKeyRef`, or
`apiKeyEnv`).

Network price synchronization is limited to the provider documentation hosts listed
in `package.json`. The OpenRouter catalogue URL is fixed to the official HTTPS API;
configuration cannot turn it into an arbitrary request target.

## Development

```console
pnpm install --frozen-lockfile
pnpm check
pnpm test
pnpm test:coverage
pnpm test:live
pnpm audit
pnpm run release:build
pnpm run release:verify
```

`test:live` contacts public price/documentation endpoints and reports each source
separately. Balance adapters use fixtures in automated tests; they do not require or
read a personal account.

The sibling `dsh-sandbox` directory, old release archives, databases, credentials,
and machine-local screenshots are maintainer-only data and are not part of this
repository or release package.

## Release policy

Tags matching `v*` build GitHub Release assets: the `.tgz`, `SHA256SUMS.txt`, an SPDX
SBOM, and release notes. There is no npm-publish job. See
[RELEASE_CHECKLIST.md](RELEASE_CHECKLIST.md) and [CONTRIBUTING.md](CONTRIBUTING.md).

## Security

Please use GitHub private vulnerability reporting rather than opening a public
security issue. See [SECURITY.md](SECURITY.md).

## License

MIT © 2026 elviass
