# Rules & scoring

The rules engine combines discovered licenses (project + third-party), the proprietary heuristic, and the network-service heuristic into ranked findings.

## Rules

| Rule | Severity | Trigger |
|---|---|---|
| `COPYLEFT-IN-PROPRIETARY` | critical | Strong copyleft (GPL) in a proprietary codebase |
| `NETWORK-COPYLEFT` | critical | AGPL/EUPL/OSL-style license, especially in a network service |
| `NON-OPEN-LICENSE` | critical | SSPL, CC-BY-NC*, and other non-open licenses |
| `DENIED-LICENSE` | critical | License matched your `--deny-license` policy (never suppressed) |
| `PROJECT-LICENSE-CONFLICT` | error | Root LICENSE is copyleft but the project appears proprietary |
| `PROJECT-LICENSE-UNFREE` | error | Root LICENSE restricts use |
| `WEAK-COPYLEFT` | warning | MPL, EPL, CDDL, LGPL — disclose modifications |
| `UNKNOWN-LICENSE` | warning | Unidentifiable license text — `secular ai` can classify it |
| `MISSING-NOTICE` | info | Attribution licenses present but no NOTICE/THIRD-PARTY file |

List them live with `secular --list-rules`.

## Compliance score

0–100, penalized per finding:

| Severity | Penalty |
|---|---|
| critical | −30 |
| error | −15 |
| warning | −5 |
| info | −1 |

Clean scan = 100; floor is 0.

## Policy gates

Gates turn findings/discoveries into exit codes for CI. All are evaluated **after** the report is emitted, so `-o file` still writes the report when a gate fails.

```bash
secular scan . --strict                          # any finding fails
secular scan . --fail-on-rule NETWORK-COPYLEFT   # specific rules fail
secular scan . --fail-on-category strong-copyleft
secular scan . --fail-on-score 90
secular scan . --fail-on-unknown
secular scan . --deny-license SSPL-1.0 --deny-license AGPL-3.0-only
secular scan . --allow-license MIT               # suppress findings for allowed ids
```

`--min-score <n>` is different: it controls how much fingerprint confidence secular requires before trusting a match (0–1, default 0.9 for root LICENSE, 0.7 for nested files).

## Proprietary heuristic

The engine needs to know whether your project is proprietary/closed-source:

- **No root LICENSE** → assumed proprietary (third-party copyleft is flagged)
- **Root LICENSE present** (any category) → assumed open-source intent; only `PROJECT-LICENSE-CONFLICT` / `PROJECT-LICENSE-UNFREE` can still fire

Override by adding/removing the root `LICENSE` file — there is deliberately no `--proprietary` flag so CI results always match what a fresh clone sees.

## Legal note

Findings are engineering guidance, not legal advice. License compatibility depends on how you link, distribute, and host software. For high-stakes decisions, consult qualified counsel.
