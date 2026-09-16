# CLI reference

```
secular <command> [dir] [options]
```

## Commands

| Command | Description |
|---|---|
| `scan [dir]` | Scan a codebase (default command) |
| `notice [dir]` | Generate a THIRD-PARTY-NOTICES file |
| `ai [dir]` | Scan + AI adjudication of custom/unknown licenses (needs API key) |
| `cache --refresh` | Refresh the SPDX catalog cache; without `--refresh`, fetches only if no cache exists |

## Output options

| Option | Description |
|---|---|
| `-f, --format <fmt>` | `terminal` \| `json` \| `markdown` \| `sarif` |
| `-o, --output <file>` | Write the report to a file |
| `--summary` | One line: `score · files · findings · duration` |
| `--json-include-license-files` | Per-file license + confidence in JSON output |
| `--no-color` | Disable color (auto off when piped; respects `NO_COLOR`) |
| `-q, --quiet` | Suppress notes/warnings on stderr |
| `--notice-format <fmt>` | `notice`: `markdown` (default) or `text` |
| `--append-notice` | Append to the notices file instead of overwriting |

## Policy gates

| Option | Description |
|---|---|
| `--strict` | Exit 1 on any finding at/above `--min-severity` |
| `--min-severity <sev>` | Filter: `info` \| `warning` \| `error` \| `critical` |
| `--fail-on-rule <rule>` | Exit 1 if this rule fires (repeatable; see `--list-rules`) |
| `--fail-on-category <cat>` | Exit 1 if any license matches a category (repeatable) |
| `--fail-on-score <n>` | Exit 1 if the compliance score is below n (0–100) |
| `--fail-on-unknown` | Exit 1 if any license text went unidentified |
| `--deny-license <id>` | Exit 1 if this SPDX id is found (repeatable) |
| `--allow-license <id>` | Suppress findings for this SPDX id (repeatable) |
| `--min-score <n>` | Only trust fingerprint matches at/above this confidence (0–1) |

All gates are evaluated **after** the report is emitted, so `-o file` still produces the report when a gate fails.

## Scan control

| Option | Description |
|---|---|
| `--exclude <dir>` | Skip a directory by name at any depth (repeatable) |
| `--exclude-file <name>` | Skip files by basename (repeatable, case-insensitive) |
| `--skip-mode <mode>` | `auto` \| `ask` \| `scan` — see [skip-modes.md](skip-modes.md) |
| `--scan-all` | Shorthand for `--skip-mode scan` |
| `-y, --yes` | In ask mode, auto-answer "ignore" |
| `--no-vendor-scan` | Skip everything under `vendor`-style dirs, licenses included |
| `--include-hidden` | Also scan hidden (dot-prefixed) directories |
| `--max-files <n>` | Cap the number of files scanned |
| `--timeout <seconds>` | Abort the scan if it exceeds this duration |
| `--dep-audit` | List declared deps with no matching disk license (JSON `depAudit`) |
| `--refresh` | Force SPDX catalog refresh before scanning |

## Introspection & scaffolding

| Option | Description |
|---|---|
| `--list-rules` | Print all rules with severities and exit |
| `--license-info <id>` | Secular's classification metadata for an SPDX id |
| `--spdx-info <id>` | SPDX catalog entry (name, OSI status, deprecated) |
| `--init` | Create a `.secularrc.json` scaffold |
| `--init-ci` | Create a GitHub Actions license-scanning workflow |
| `--config <file>` | Read options from a JSON config file |

## AI options

| Option | Description |
|---|---|
| `-k, --api-key <key>` | LLM API key (or `SECULAR_API_KEY` / `OPENAI_API_KEY` env) |
| `--provider <name>` | `openai` \| `anthropic` \| `openrouter` \| `ollama` |
| `--model <model>` | Model id (provider default if omitted) |
| `--base-url <url>` | Custom OpenAI-compatible endpoint |

## CI preset

`--ci` is shorthand for `--strict --quiet --format sarif`:

```bash
secular scan . --ci -o license.sarif
```

## Exit codes

| Code | Meaning |
|---|---|
| `0` | Clean — no findings at/above the threshold |
| `1` | Findings present, or a policy gate matched |
| `2` | Usage or IO error |

## Environment variables

| Variable | Purpose |
|---|---|
| `SECULAR_API_KEY` | LLM API key (preferred) |
| `SECULAR_PROVIDER` / `SECULAR_MODEL` / `SECULAR_BASE_URL` | AI overrides |
| `SECULAR_SKIP_MODE` | Default skip-mode: `auto` \| `ask` \| `scan` |
| `SECULAR_RC` | Path to a config file |
| `SECULAR_HOME` | Redirect the cache directory |
| `SECULAR_DEBUG` | Full stack traces on internal errors |
