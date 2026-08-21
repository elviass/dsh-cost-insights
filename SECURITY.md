# Security policy

## Supported version

Security fixes are provided for the latest stable release.

## Reporting a vulnerability

Use [GitHub private vulnerability reporting](https://github.com/elviass/dsh-usage-insights/security/advisories/new). Do not open a public issue for a suspected vulnerability.

Please include the plugin version, DSH version, operating system, reproduction steps, and a sanitized diagnostic export. Never include API keys, prompts, response text, or an unredacted database.

## Data boundary

The plugin stores usage metadata and pricing snapshots under `DSH_HOME`. It does not store prompts, response text, or API keys. Diagnostic exports are intentionally sanitized.
