# Secular™

**AI-powered license compliance scanning for your codebase.**

Point Secular at any repository and get a complete license compliance report: every license detected by **full-text fingerprinting** against the SPDX catalog, violations ranked by severity, and a 0–100 compliance score. Add an API key and Secular's AI layer adjudicates even custom and unknown license texts.

> **Status:** early release. Secular is not yet published to npm — for now, install from source (below).

Real output from a real scan of a test repository:

```text
$ node dist/cli.js scan ./my-project

Secular™ — license compliance report
/tmp/fixture

Scanned 3 files · SPDX catalog vspdx-license-list@6 (727 texts)

  Compliance score: 70/100

Project licenses
  • MIT (Permissive) src/index.ts

Third-party licenses
  • GPL-3.0+ (Strong copyleft, 1 file)

Findings (1)
  ✗ [CRITICAL] Strong copyleft license "GPL-3.0+" found in a proprietary codebase
    COPYLEFT-IN-PROPRIETARY · third_party/libgpl/LICENSE
    GPL-3.0+ is Strong copyleft. If you link or distribute this code, GPL
    obligations apply to the combined work.
    → Remove/replace the dependency, isolate it behind a separate process
      (GPL boundary), or open-source the combined work under GPL-3.0+.
```

---

## Table of contents

- [Why Secular](#why-secular)
- [Installation](#installation)
- [Quick start](#quick-start)
- [Commands](#commands)
- [Options](#options)
- [AI providers](#ai-providers)
- [Exit codes & CI usage](#exit-codes--ci-usage)
- [What it detects](#what-it-detects)
- [Severity model & compliance score](#severity-model--compliance-score)
- [How detection works](#how-detection-works)
- [Output formats](#output-formats)
- [Configuration via environment variables](#configuration-via-environment-variables)
- [Caching & offline use](#caching--offline-use)
- [Development](#development)
- [Troubleshooting](#troubleshooting)
- [Legal note](#legal-note)
- [License](#license)

---

## Why Secular

| Capability | Secular | Typical license scanners |
|---|---|---|
| **Detection** | Full-text fingerprinting against **727 SPDX license texts** (shingle containment + length disambiguation) — reads the actual license, not metadata | Reads the `license:` field in your manifest and trusts it |
| **Ambiguous licenses** | AI adjudication classifies custom/unknown license texts | Reports "unknown" and stops |
| **Analysis** | Compatibility rules engine: copyleft strength, network copyleft (AGPL), non-open licenses, NOTICE obligations | Flat list of licenses found |
| **Context awareness** | Detects network-service stacks (Express, FastAPI, Gin, …) and escalates AGPL-style risk accordingly | None |
| **Output** | Terminal, JSON, Markdown, **SARIF 2.1.0** (GitHub Code Scanning native) | Plain text |
| **Runtime dependencies** | **Zero** — one Node CLI, SPDX data cached locally | Heavy dependency trees |
| **CI** | `--strict` gate, meaningful exit codes, SARIF upload | Varies |
| **Offline** | Rules engine + fingerprinting work fully offline | Often requires registry access |

## Installation

Requires **Node.js ≥ 18**. Secular is currently **install from source** (not yet on npm):

```bash
git clone https://github.com/HahaAhhDev/secular.git
cd secular
npm install        # dev dependencies only: TypeScript + Node type defs
npm run build      # compiles TypeScript → dist/
```

That's it. Run the CLI with:

```bash
node dist/cli.js scan /path/to/repo

# Optional: create a short alias for convenience
alias secular='node /path/to/secular/dist/cli.js'
```

## Quick start

```bash
# 1. Plain scan — no API key needed
node dist/cli.js scan .

# 2. Scan with AI adjudication for unknown/custom licenses
node dist/cli.js ai . --api-key sk-ant-...

# 3. CI gate with SARIF output for GitHub Code Scanning
node dist/cli.js scan . -f sarif -o license.sarif --strict

# 4. Generate a THIRD-PARTY-NOTICES file for your distribution
node dist/cli.js notice . -o THIRD-PARTY-NOTICES.md

# 5. Refresh the local SPDX catalog
node dist/cli.js cache --refresh
```

## Commands

### `scan [dir]`

Scans a directory for license violations. Default command — running with no subcommand scans the current directory.

### `ai [dir]`

Everything `scan` does, plus AI adjudication. Any license file or inline header that the fingerprinter can't confidently match (or matches below 90%) is sent to your configured LLM for classification. Adjudicated licenses are folded back into the rules engine, so findings and the compliance score update automatically.

Requires `--api-key` or `SECULAR_API_KEY`/`OPENAI_API_KEY`.

### `notice [dir]`

Generates a `THIRD-PARTY-NOTICES.md` (or a path you choose with `-o`) listing every third-party license discovered, ready to ship with your distribution.

### `cache --refresh`

Forces a refresh of the local SPDX license catalog (727 license texts). The cache lives in `~/.secular/spdx` and auto-refreshes weekly; use this to force it sooner.

## Options

| Option | Description |
|---|---|
| `-k, --api-key <key>` | LLM API key (or `SECULAR_API_KEY` / `OPENAI_API_KEY` env) |
| `--provider <name>` | `openai` \| `anthropic` \| `openrouter` \| `ollama` |
| `--model <model>` | Model id (provider default used if omitted) |
| `--base-url <url>` | Custom OpenAI-compatible endpoint |
| `-f, --format <fmt>` | `terminal` \| `json` \| `markdown` \| `sarif` |
| `-o, --output <file>` | Write the report to a file instead of stdout |
| `--min-severity <sev>` | Only report findings at or above: `info` \| `warning` \| `error` \| `critical` |
| `--strict` | Exit non-zero if **any** finding exists (CI gate) |
| `--refresh` | Force SPDX catalog refresh before scanning |
| `-h, --help` | Show help |
| `-v, --version` | Show version |

## AI providers

Secular auto-detects the provider from the API key prefix:

| Provider | Key prefix | Default model | Endpoint |
|---|---|---|---|
| OpenAI | `sk-...` | `gpt-4o-mini` | `https://api.openai.com/v1` |
| Anthropic | `sk-ant-...` | `claude-sonnet-4-20250514` | `https://api.anthropic.com/v1` |
| OpenRouter | `sk-or-...` | `openai/gpt-4o-mini` | `https://openrouter.ai/api/v1` |
| Ollama (local) | — | `llama3.1` | `http://localhost:11434/v1` |

Any OpenAI-compatible endpoint works via `--base-url` (vLLM, LM Studio, Azure OpenAI gateways, etc.).

```bash
# Anthropic, auto-detected from the key
node dist/cli.js ai . --api-key sk-ant-...

# Explicit provider + model
node dist/cli.js ai . --provider anthropic --model claude-sonnet-4-20250514 --api-key sk-ant-...

# Local Ollama — no API key needed, just a running server
node dist/cli.js ai . --provider ollama

# Any OpenAI-compatible endpoint
node dist/cli.js ai . --base-url http://localhost:8080/v1 --model my-model --api-key local
```

## Exit codes & CI usage

| Code | Meaning |
|---|---|
| `0` | Clean — no findings (or only findings below `critical`) |
| `1` | Findings present: any finding with `--strict`, or any `critical` finding otherwise |
| `2` | Usage/IO error (bad arguments, missing directory, unwritable output, AI config missing) |

### GitHub Actions example

Since Secular isn't on npm yet, check it out and build in CI:

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

The SARIF upload makes every finding appear directly in GitHub's **Security → Code scanning** view.

### Plain CI gate

```bash
node dist/cli.js scan . --strict          # fails on ANY finding
node dist/cli.js scan . --strict --min-severity error   # fails only on error/critical
```

## What it detects

**License sources:**

- Root project license — `LICENSE`, `LICENCE`, `COPYING`, `NOTICE`, `COPYRIGHT` (any extension: `.md`, `.txt`, `.rst`, `.html`)
- Vendored third-party licenses — license files at any depth in your tree
- Inline source headers — `SPDX-License-Identifier:` tags and full license text in the first 2 KB of each source file
- Dependency manifests — `package.json`, `Cargo.toml`, `go.mod`, `pyproject.toml`, `Gemfile`, `composer.json` (npm, Cargo, Go, PyPI, RubyGems, Packagist)

**Findings (rules):**

| Rule | Severity | Trigger |
|---|---|---|
| `COPYLEFT-IN-PROPRIETARY` | critical | Strong copyleft (GPL) in a proprietary codebase |
| `NETWORK-COPYLEFT` | critical | AGPL/EUPL/OSL-style license, especially in a network service |
| `NON-OPEN-LICENSE` | critical | SSPL, CC-BY-NC*, and other non-open licenses |
| `PROJECT-LICENSE-CONFLICT` | error | Root LICENSE is copyleft but project appears proprietary |
| `PROJECT-LICENSE-UNFREE` | error | Root LICENSE restricts use (non-open) |
| `WEAK-COPYLEFT` | warning | MPL, EPL, CDDL, LGPL — usually fine, disclose modifications |
| `UNKNOWN-LICENSE` | warning | Unidentifiable license text — AI adjudication recommended |
| `MISSING-NOTICE` | info | Attribution licenses present but no NOTICE/THIRD-PARTY file |

## Severity model & compliance score

The 0–100 compliance score starts perfect and is penalized per finding:

| Severity | Penalty per finding |
|---|---|
| critical | −30 |
| error | −15 |
| warning | −5 |
| info | −1 |

The score floors at 0. A clean scan is 100; a single GPL-in-proprietary finding drops it to 70.

## How detection works

1. **Walk** — traverses the repository, skipping `node_modules`, `.git`, `dist`, `build`, `vendor`, and other artifact directories.
2. **Fingerprint** — every license file and source-file header is normalized (lowercased, copyright years and placeholders stripped, punctuation removed), hashed into 8-word shingles, and matched against the SPDX catalog by containment similarity. Ties break by **text-length similarity**, so plain `MIT` correctly beats superset lookalikes like `FSL-1.1-MIT` or `X11`. Root LICENSE files demand ≥90% confidence and reject partial-text matches; sub-threshold files stay unclassified rather than guessing wrong.
3. **Parse manifests** — extracts the dependency surface per ecosystem.
4. **Evaluate** — the rules engine combines licenses, project context (root license, network-service heuristics, notice files), and produces ranked findings.
5. **Adjudicate** *(optional)* — ambiguous licenses go to the LLM; confident classifications are merged back and rules re-run.
6. **Report** — emit in terminal, JSON, Markdown, or SARIF.

## Output formats

```bash
node dist/cli.js scan .                      # human-readable terminal report (default)
node dist/cli.js scan . -f json              # machine-readable JSON (full report)
node dist/cli.js scan . -f markdown          # GitHub-friendly Markdown report
node dist/cli.js scan . -f sarif             # SARIF 2.1.0 for GitHub Code Scanning
node dist/cli.js scan . -f json -o out.json  # any format can be written to a file
```

JSON includes every field the terminal report shows (license maps, dependencies, findings, score) plus the SPDX catalog version — suitable for building dashboards or tracking compliance over time.

## Configuration via environment variables

| Variable | Purpose |
|---|---|
| `SECULAR_API_KEY` | LLM API key (preferred over `OPENAI_API_KEY`) |
| `SECULAR_PROVIDER` | Override provider auto-detection |
| `SECULAR_MODEL` | Override the default model |
| `SECULAR_BASE_URL` | Override the API endpoint |
| `SECULAR_HOME` | Redirect the config/cache directory (default: your home dir) |

## Caching & offline use

- The SPDX catalog (727 license texts) is fetched once and cached at `~/.secular/spdx/licenses.json`.
- The cache is refreshed automatically if older than **1 week**.
- `node dist/cli.js cache --refresh` forces an immediate refresh.
- If a fetch fails but a cache exists, the **stale cache is used** — scanning always works offline once primed.
- The rules engine and fingerprinting never need network access; only AI adjudication does.

## Development

```bash
git clone https://github.com/HahaAhhDev/secular.git
cd secular
npm install
npm run build        # compile TypeScript → dist/
npm run typecheck    # strict typecheck, no emit

# Run locally
node dist/cli.js scan /path/to/repo

# Smoke test on a scratch repo
mkdir -p /tmp/demo && printf '// SPDX-License-Identifier: MIT\n' > /tmp/demo/a.ts
node dist/cli.js scan /tmp/demo
```

Project layout:

```
src/
├── cli.ts        CLI entry: arg parsing, commands, exit codes
├── walker.ts     Filesystem walker with ignore rules
├── detect.ts     Shingle-fingerprint license matcher
├── spdx.ts       SPDX catalog fetch + local cache
├── manifests.ts  Dependency manifest parsers (6 ecosystems)
├── meta.ts       License category metadata (~40 licenses)
├── rules.ts      Compatibility rules engine + scoring
├── scan.ts       Orchestration
├── ai.ts         LLM adjudication (OpenAI-compatible + Anthropic)
└── report.ts     Terminal / JSON / Markdown / SARIF / NOTICE emitters
```

## Troubleshooting

**`Could not fetch SPDX catalog and no local cache exists`** — run `node dist/cli.js cache --refresh` once with network access, or check proxy settings. After the first successful fetch, scanning works offline.

**License shows as "Unknown"** — the text didn't match any SPDX entry closely enough (this is intentional for truncated or heavily modified texts — Secular won't guess). Run `node dist/cli.js ai .` with an API key; the AI layer classifies custom licenses. Alternatively, add the correct `SPDX-License-Identifier` header to the source files.

**False copyleft warnings from a single header** — Secular treats inline `SPDX-License-Identifier` tags as intentional license declarations. Fix the header on the affected file.

**API adjudication fails with 401/403** — check the key and that `--provider` matches your key's provider. `sk-ant-...` keys route to Anthropic automatically; other prefixes default to OpenAI.

**Score lower than expected** — check for `info` findings (MISSING-NOTICE); each costs 1 point. Run `node dist/cli.js notice .` to clear them.

## Legal note

Secular is a detection and analysis tool. Findings are engineering guidance, not legal advice — license compatibility depends on how you link, distribute, and host software. For high-stakes licensing questions, consult qualified counsel.

## License

Secular is licensed under the [Controlled Permissive License (HahaAhhDev-CPL-1.0)](LICENSE) — permissive for commercial and proprietary use, revocable by the copyright holder with written notice, attribution required.
