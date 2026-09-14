# Secular™

**Elite AI-powered license compliance scanning.** Enter an API key, point it at a codebase, and get a world-class license violation report in seconds.

```
$ npx secular ai . --api-key sk-...
Secular™ — license compliance report
  Compliance score: 70/100
  ✗ [CRITICAL] Strong copyleft license "GPL-3.0+" found in a proprietary codebase
    → Remove/replace the dependency, isolate it behind a separate process, or open-source the combined work.
```

## Why Secular wins

| | Secular | Traditional scanners |
|---|---|---|
| **Detection** | Full-text fingerprinting against **727 SPDX license texts** (shingle containment + length-disambiguation) | Manifest declares `license: "MIT"` and trusts it |
| **Ambiguous licenses** | AI adjudication layer classifies unknown/custom texts | "Unknown license" — good luck |
| **Analysis** | Compatibility rules engine: copyleft strength, network copyleft (AGPL), non-open licenses, NOTICE obligations | Flat list of licenses |
| **Output** | Terminal, JSON, **SARIF 2.1.0** (GitHub Code Scanning), Markdown | Text |
| **Runtime deps** | **Zero.** Single Node binary, SPDX data cached locally | Heavy install trees |
| **CI** | `--strict` gate + SARIF, exit codes that mean something | Varies |

## What it detects

- **Root project license** — LICENSE / COPYING / NOTICE files at any depth, plus inline `SPDX-License-Identifier:` headers on first-party code
- **Vendored third-party licenses** — LICENSE files inside your tree
- **Dependencies** — npm, Cargo, Go, PyPI, RubyGems, Packagist manifests
- **Violations**:
  - Strong copyleft (GPL) in a proprietary codebase → **critical**
  - Network copyleft (AGPL, EUPL, OSL) in what looks like a network service → **critical**
  - Non-open licenses (SSPL, CC-BY-NC) → **critical**
  - Weak copyleft (MPL, EPL, CDDL, LGPL) → warning
  - Unclassifiable license text → warning (AI can adjudicate)
  - Missing attribution/NOTICE → info
- **Compliance score** — 0–100, weighted by severity

## Quick start

```bash
# Plain scan (no AI needed — rules engine + fingerprinting work offline)
secular scan .

# Full AI boot-up: one API key, done
secular ai . --api-key sk-ant-...

# CI gate with SARIF for GitHub Code Scanning
secular scan . -f sarif -o license.sarif --strict

# Generate attribution file
secular notice . -o THIRD-PARTY-NOTICES.md
```

The AI layer works with any OpenAI-compatible endpoint and auto-detects the provider from the key prefix:

- **OpenAI** (`sk-...`) — default
- **Anthropic** (`sk-ant-...`)
- **OpenRouter** (`sk-or-...`)
- **Ollama / local** — `--provider ollama --base-url http://localhost:11434/v1`

Env vars: `SECULAR_API_KEY`, `SECULAR_PROVIDER`, `SECULAR_MODEL`, `SECULAR_BASE_URL`.

## Commands

```
secular scan [dir]        Scan a codebase for license violations
secular ai [dir]          Scan + AI-adjudicate ambiguous licenses
secular notice [dir]      Generate THIRD-PARTY-NOTICES.md
secular cache --refresh   Refresh the local SPDX catalog (~/.secular/spdx)
```

## Options

```
-k, --api-key <key>       LLM API key (or SECULAR_API_KEY env)
    --provider <name>     openai | anthropic | openrouter | ollama
    --model <model>       Model id
    --base-url <url>      Custom OpenAI-compatible endpoint
-f, --format <fmt>        terminal | json | markdown | sarif
-o, --output <file>       Write report to a file
    --min-severity <s>    info | warning | error | critical
    --strict              Exit non-zero on any finding (CI)
    --refresh             Force SPDX catalog refresh
```

## How detection works

1. **Walk** the repo (respects node_modules/.git/dist-style ignore rules).
2. **Fingerprint** every LICENSE/COPYING/NOTICE file and the first 2 KB of source files: normalize (lowercase, strip years/placeholders/punctuation), 8-word shingle hashing, containment similarity against the SPDX catalog. Ties break by length similarity, so plain MIT beats MIT-superset lookalikes (FSL-1.1-MIT, X11, …).
3. **Parse** dependency manifests for the dependency surface.
4. **Evaluate** the compatibility rules engine with project context (proprietary? network service?).
5. **Adjudicate** anything ambiguous with the AI layer (optional).
6. **Report** in your format of choice.

## Development

```bash
npm install
npm run build      # tsc → dist/
npm run typecheck
secular scan <dir>
```

## Legal note

Secular is a detection and analysis tool. Findings are engineering guidance, not legal advice — for high-stakes licensing questions, consult counsel.

## License

See [LICENSE](LICENSE).
