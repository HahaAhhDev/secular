# Secular™

**License compliance scanning for your codebase — with optional AI adjudication for custom licenses.**

Secular walks your repository, fingerprint-matches every license file and source header against the full SPDX catalog, parses dependency manifests, and applies a compatibility rules engine. The output: ranked findings, a 0–100 compliance score, and reports in terminal, JSON, Markdown, or SARIF.

Everything runs offline. The only feature that touches the network is AI adjudication (optional) and the initial SPDX catalog fetch (cached).

## How it works

1. **Walk** — traverse the repo, skipping `node_modules`, `.git`, `dist`, `build`, and other artifact directories. License files inside `vendor`-style directories are still collected (their source code is skipped).
2. **Fingerprint** — normalize license text (lowercase, strip copyright years and placeholders), hash into 8-word shingles, and match against SPDX by containment similarity. A popularity prior breaks ties between near-duplicate families, so a truncated MIT file matches `MIT` — not `MIT-0` or `X11`. Root `LICENSE` files demand ≥90% confidence.
3. **Parse manifests** — `package.json`, `Cargo.toml`, `go.mod`, `pyproject.toml`, `Gemfile`, `composer.json`.
4. **Detect headers** — `SPDX-License-Identifier:` tags and full license text in the first 2 KB of source files.
5. **Evaluate** — the rules engine combines licenses, project context, and network-service heuristics into ranked findings.
6. **Adjudicate** *(optional, `ai` command)* — custom or low-confidence license texts go to an LLM; classifications fold back into the rules engine.

## Installation

Requires Node.js ≥ 18.

**GitHub Packages** (published as `@hahaahhdev/secular`):

```bash
# One-time setup: authenticate npm against GitHub Packages
github_token=$(gh auth token)   # or a PAT with read:packages
npm config set @hahaahhdev:registry https://npm.pkg.github.com
npm config set //npm.pkg.github.com/:_authToken="$github_token"

# Then install globally
npm install -g @hahaahhdev/secular
secular --version
```

> GitHub Packages requires authentication for installs, so this two-line npm config is needed once per machine.

**Install script** (Linux/macOS) — clones, builds, and puts `secular` on your PATH:

```bash
curl -fsSL https://raw.githubusercontent.com/HahaAhhDev/secular/master/install.sh -o install.sh
./install.sh                 # user install (~/.local); use sudo for system-wide

# later:
curl -fsSL https://raw.githubusercontent.com/HahaAhhDev/secular/master/uninstall.sh -o uninstall.sh
./uninstall.sh
```

**From source:**

```bash
git clone https://github.com/HahaAhhDev/secular.git
cd secular
npm install        # dev deps only: TypeScript + Node types
npm run build
node dist/cli.js --help
```

**Or link directly** if you have the repo cloned:

```bash
cd secular && npm link   # `secular` available globally from any directory
```

## Quick start

```bash
secular scan .                     # offline scan, terminal report
secular scan . -f sarif -o license.sarif --strict   # CI gate + Code Scanning
secular notice . -o THIRD-PARTY-NOTICES.md          # attribution file
secular ai . --api-key sk-ant-...  # + AI adjudication of custom licenses
secular cache --refresh            # refresh the SPDX catalog cache
```

`secular` works from any directory — pass the target project's path as the first argument (`secular scan /path/to/project`). Global installs give you the `secular` command everywhere; `npx @hahaahhdev/secular scan .` works too.

## Commands

| Command | Description |
|---|---|
| `scan [dir]` | Scan a codebase (default command). |
| `ai [dir]` | Scan + AI adjudication. Classifies custom/unknown license texts via your LLM. Needs `--api-key` or `SECULAR_API_KEY`/`OPENAI_API_KEY`. |
| `notice [dir]` | Generate a `THIRD-PARTY-NOTICES.md` from detected third-party licenses. |
| `cache --refresh` | Force-refresh the SPDX catalog cache. |

## Options

| Option | Description |
|---|---|
| `-k, --api-key <key>` | LLM API key (or `SECULAR_API_KEY` / `OPENAI_API_KEY` env) |
| `--provider <name>` | `openai` \| `anthropic` \| `openrouter` \| `ollama` |
| `--model <model>` | Model id (provider default if omitted) |
| `--base-url <url>` | Custom OpenAI-compatible endpoint |
| `-f, --format <fmt>` | `terminal` \| `json` \| `markdown` \| `sarif` |
| `-o, --output <file>` | Write the report to a file |
| `--min-severity <sev>` | Only report findings at or above: `info` \| `warning` \| `error` \| `critical` |
| `--strict` | Exit non-zero if any finding exists at or above the threshold (CI gate) |
| `--refresh` | Force SPDX catalog refresh before scanning |
| `-h, --help` / `-v, --version` | Help / version |

Note: `--strict` combines with `--min-severity`. Exit code `1` without `--strict` means at least one `critical` finding.

## Exit codes

| Code | Meaning |
|---|---|
| `0` | Clean — no findings at or above the threshold |
| `1` | Findings present (any with `--strict`, otherwise any `critical`) |
| `2` | Usage or IO error |

### GitHub Actions

```yaml
name: license-compliance
on: [push, pull_request]

jobs:
  secular:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - name: Build secular
        run: |
          git clone https://github.com/HahaAhhDev/secular.git /tmp/secular
          cd /tmp/secular && npm install && npm run build
      - name: Scan
        run: /tmp/secular/dist/cli.js scan . -f sarif -o license.sarif --strict
      - uses: github/codeql-action/upload-sarif@v3
        if: always()
        with:
          sarif_file: license.sarif
```

## Rules

| Rule | Severity | Trigger |
|---|---|---|
| `COPYLEFT-IN-PROPRIETARY` | critical | Strong copyleft (GPL) in a proprietary codebase |
| `NETWORK-COPYLEFT` | critical | AGPL/EUPL/OSL-style license, especially in a network service |
| `NON-OPEN-LICENSE` | critical | SSPL, CC-BY-NC*, and other non-open licenses |
| `PROJECT-LICENSE-CONFLICT` | error | Root LICENSE is copyleft but project appears proprietary |
| `PROJECT-LICENSE-UNFREE` | error | Root LICENSE restricts use (non-open) |
| `WEAK-COPYLEFT` | warning | MPL, EPL, CDDL, LGPL — disclose modifications |
| `UNKNOWN-LICENSE` | warning | Unidentifiable license text — `secular ai` can classify it |
| `MISSING-NOTICE` | info | Attribution licenses present but no NOTICE/THIRD-PARTY file |

### Compliance score

0–100, penalized per finding: critical −30, error −15, warning −5, info −1. Floor 0, clean scan 100.

## AI adjudication

`secular ai` sends any license file that (a) doesn't match the catalog, (b) matches below 90% confidence, or (c) matches an id with no known category — i.e. **custom and non-SPDX licenses** — to your configured LLM. The AI returns an SPDX-or-best-guess id, a copyleft category, obligations, and a confidence score. Classifications with confidence ≥ 50% are folded back into the rules engine, so findings and score update automatically. A root `LICENSE` file adjudicated by the AI is treated as the project's own license; nested files are treated as third-party.

Providers are auto-detected from key prefix (`sk-ant-` → Anthropic, `sk-or-` → OpenRouter, otherwise OpenAI). Any OpenAI-compatible endpoint works via `--base-url`. Local Ollama needs no key:

```bash
secular ai . --provider ollama
```

## Caching & offline use

- The SPDX catalog (727 license texts, via `spdx-license-list@6`) is fetched once and cached at `~/.secular/spdx/licenses.json`.
- Refreshes automatically after 1 week; `secular cache --refresh` forces it sooner.
- If a fetch fails but a cache exists, the stale cache is used — scanning works offline once primed.
- Fingerprinting and the rules engine never need network access.

## Environment variables

| Variable | Purpose |
|---|---|
| `SECULAR_API_KEY` | LLM API key (preferred over `OPENAI_API_KEY` / `ANTHROPIC_API_KEY`) |
| `SECULAR_PROVIDER` | Override provider auto-detection |
| `SECULAR_MODEL` | Override the default model |
| `SECULAR_BASE_URL` | Override the API endpoint |
| `SECULAR_HOME` | Redirect the cache directory (default: home dir) |
| `SECULAR_DEBUG` | Print full stack traces on internal errors |

## Development

```bash
npm install
npm run typecheck    # strict typecheck, no emit
npm run build        # compile to dist/
npm test             # 43 tests over detect, manifests, walker, rules, meta, report, ai
```

### Releasing

Releases are automated: pushing a `v*` tag triggers a workflow that builds, tests, and publishes to GitHub Packages.

```bash
./scripts/release.sh patch   # 1.0.0 -> 1.0.1 (also: minor, major, or an explicit x.y.z)
```

The helper bumps the version, runs the test suite, creates a release commit + tag, and (after confirmation) pushes both. You can also push manually with `git push origin master vX.Y.Z`.

### CI

Two workflows ship with the repo:

- **ci.yml** — typecheck, build, tests, and CLI smoke tests on Node 18/20/22 for every push/PR, plus a scheduled weekly run that catches environment drift.
- **release.yml** — on a pushed `v*` tag: build, test, verify the tag matches `package.json`, then publish to GitHub Packages. No secrets to configure; it uses the built-in `GITHUB_TOKEN`.

Layout:

```
src/
├── cli.ts        CLI entry: arg parsing, commands, AI loop, exit codes
├── walker.ts     Filesystem walker with ignore rules
├── detect.ts     Shingle-fingerprint license matcher
├── spdx.ts       SPDX catalog fetch + local cache
├── manifests.ts  Dependency manifest parsers (6 ecosystems)
├── meta.ts       License category metadata
├── rules.ts      Compatibility rules engine + scoring
├── scan.ts       Scan orchestration
├── ai.ts         LLM adjudication (OpenAI-compatible + Anthropic)
└── report.ts     Terminal / JSON / Markdown / SARIF / NOTICE emitters
```

## Troubleshooting

**No API key needed for scanning** — `scan`, `notice`, and `cache` work fully offline without any key. Only `secular ai` requires one.

**"Could not fetch SPDX catalog and no local cache exists"** — run `secular cache --refresh` once with network access. After that, scanning works offline. A failed refresh falls back to the cached catalog.

**License shows as "Unknown"** — the text didn't match the catalog closely enough; Secular deliberately doesn't guess. Run `secular ai .` with an API key, or fix the file's `SPDX-License-Identifier` header.

**Score lower than expected** — check for `info` findings (`MISSING-NOTICE` costs 1 point each). `secular notice .` generates the missing file.

## Legal note

Secular is a detection and analysis tool. Findings are engineering guidance, not legal advice — license compatibility depends on how you link, distribute, and host software. For high-stakes questions, consult qualified counsel.

## License

Secular is licensed under the [Controlled Permissive License (HahaAhhDev-CPL-1.0)](LICENSE) — permissive for commercial and proprietary use, revocable by the copyright holder with written notice, attribution required.
