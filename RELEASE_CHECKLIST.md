# v1.0.0 release checklist

## Completed locally on 2026-08-22

- [x] Independent `main` repository with a clean committed working tree.
- [x] pnpm 10.34.5 frozen install, release checks, 21 tests, coverage, high-severity audit, secret scan, and dry-run pack pass.
- [x] Live DeepSeek, OpenRouter, OpenAI, Google, Anthropic, and ECB checks return healthy, explainable results.
- [x] The final tgz installs exactly once and boots on DSH `0.1.0-rc.7` and `0.1.1-rc.2` in separate temporary `DSH_HOME` directories.
- [x] HTTP 200, desktop/narrow layouts, Chinese/English, light/dark, pricing, export entry, and zero console errors pass on both DSH versions.
- [x] SQLite is created only under each isolated compatibility-test directory.
- [x] A clean checkout produces the same tgz SHA-256 as the retained release candidate.
- [x] The release archive has 15 source-matching files and excludes tests, credentials, databases, screenshots, old tgz files, and development runtimes.
- [x] GitHub-only release workflow produces tgz, checksum, SPDX 2.3 SBOM, and generated release notes without npm publishing.

Final archive SHA-256:

```text
9388279452569974D4DACF9576F6A1A38AAE4483C0D13011ED2F8817F10F50F4  dsh-usage-insights-1.0.0.tgz
```

## Manual GitHub setup (not performed during preparation)

- [ ] Create the public repository `elviass/dsh-usage-insights` without initializing it with extra files.
- [ ] Add the GitHub remote and push `main`; confirm both Node matrix jobs and CodeQL pass.
- [ ] Enable private vulnerability reporting, Dependabot alerts/security updates, secret scanning, and push protection where available.
- [ ] Protect `main`; require the two CI matrix checks and CodeQL, and block force pushes/deletion.
- [ ] Review the sanitized screenshot, README links, and generated release notes on GitHub.
- [ ] Create and push tag `v1.0.0` only after the required checks pass.
- [ ] Confirm the GitHub Release contains the tgz, `SHA256SUMS.txt`, and SPDX SBOM. Do not run `npm publish`.
