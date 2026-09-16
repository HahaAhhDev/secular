# AI adjudication

The only feature that needs an API key. Everything else (`scan`, `notice`, `cache`) is fully offline.

## When the AI is used

`secular ai` sends license files to your LLM when any of these hold:

1. The fingerprinter found **no match** in the SPDX catalog
2. The best match scored **below 90% confidence**
3. The matched id has **no known category** (custom/non-SPDX licenses)

The AI returns an SPDX-or-best-guess id, a copyleft category, obligations, proprietary-use stance, and a confidence score. Classifications with confidence ≥ 50% fold back into the rules engine — findings and score update automatically.

Root `LICENSE` files adjudicated by the AI are treated as the **project's own** license; nested files are treated as third-party.

## Setup

Providers are auto-detected from the key prefix:

| Prefix | Provider | Default model |
|---|---|---|
| `sk-ant-` | Anthropic | claude-sonnet-4 |
| `sk-or-` | OpenRouter | openai/gpt-4o-mini |
| anything else | OpenAI | gpt-4o-mini |

```bash
secular ai . --api-key sk-ant-...

# or via env (checked in order):
export SECULAR_API_KEY=...     # preferred
export OPENAI_API_KEY=...
export ANTHROPIC_API_KEY=...
```

## Local models (no key, no network)

Ollama exposes an OpenAI-compatible endpoint:

```bash
secular ai . --provider ollama
```

## Custom endpoints

Any OpenAI-compatible chat-completions API works:

```bash
secular ai . --base-url https://my-gateway.example.com/v1 --model my-model
```

## Controls

- At most **20** files are adjudicated per run (highest-impact ones first)
- Failures (bad key, 429 rate limit, malformed responses) warn per file and never abort the scan
- The scan itself runs identically to `secular scan` — AI results only add/adjust classifications

## Privacy

License excerpts (first 400 chars of each matched file) are sent to the LLM provider you configure. Nothing else leaves your machine — no source code, no file contents beyond the excerpts, no report data.
