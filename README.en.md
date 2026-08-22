# DSH Usage Insights

[简体中文](README.md)

[![CI](https://github.com/elviass/dsh-usage-insights/actions/workflows/ci.yml/badge.svg)](https://github.com/elviass/dsh-usage-insights/actions/workflows/ci.yml)
[![CodeQL](https://github.com/elviass/dsh-usage-insights/actions/workflows/codeql.yml/badge.svg)](https://github.com/elviass/dsh-usage-insights/actions/workflows/codeql.yml)

A local usage and cost analytics plugin for DeepSeek Harness, covering tokens, cache activity, API balances, and model pricing.

![Usage analytics in the Chinese interface](docs/images/usage-cost.png)

## Features

- Filter usage and cost by conversation, workspace, model, API provider, purpose, and date range.
- Explore token, cost, and model activity through line charts, distribution charts, and a 365-day heatmap.
- Track input, cache writes, output, cache hit rate, and request count.
- Synchronize supported model prices and exchange rates, with CNY conversion for USD prices.
- Show balances from supported APIs and peak/off-peak prices for official DeepSeek calls.
- Extend the existing DSH composer statistics line and sidebar without replacing the original UI.
- Follow the DSH language and light/dark theme automatically.

## Install

1. Download `dsh-usage-insights-1.0.0.tgz` from the [v1.0.0 release](https://github.com/elviass/dsh-usage-insights/releases/tag/v1.0.0).
2. Optionally download `SHA256SUMS.txt` and verify the archive checksum.
3. Install the downloaded archive for the appropriate DSH profile:

   ```console
   dsh plugin --profile web add ./dsh-usage-insights-1.0.0.tgz
   ```

> This project is distributed only through GitHub Releases. The unscoped npm name
> `dsh-usage-insights` belongs to another publisher and is unrelated to this project.

## Usage

After installing and starting DSH, open **Settings → Usage Insights** for the full
dashboard. The line below the conversation composer shows current model pricing,
conversation cost, and supported API balances; the sidebar shows today's total cost.

In **More → About**, click the version seven times to export a sanitized diagnostic log.

## Compatibility

- DeepSeek Harness `>=0.1.0-rc.7 <0.2.0`
- Node.js `^22.19.0 || >=24.0.0`
- DSH web client

Version 1.0.0 was installation-tested with DSH `0.1.0-rc.7` and `0.1.1-rc.2` in
independent temporary `DSH_HOME` directories.

## Data and privacy

The plugin stores numeric usage metadata, provider and model identifiers, timestamps,
conversation/workspace grouping, price-source metadata, and optional balance snapshots
locally. It does not store prompts, response text, or raw API keys.

Network synchronization is limited to the pricing, exchange-rate, and balance endpoints
declared in `package.json`. Diagnostic exports remove credentials, prompts, response text,
and local database contents. Security concerns can be reported through GitHub's private
vulnerability reporting.

## License

MIT © 2026 elviass
