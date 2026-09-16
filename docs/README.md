# Secular Documentation

**License compliance scanning for your codebase** — offline fingerprinting against the full SPDX catalog, a compatibility rules engine, and optional AI adjudication for custom licenses.

- Site: https://hahaahhdev.github.io/secular/
- Source: https://github.com/HahaAhhDev/secular
- Package: `@hahaahhdev/secular` on GitHub Packages

## Documentation index

| Document | Contents |
|---|---|
| [installing.md](installing.md) | All install routes (installer, npx, GitHub Packages, source), Windows support, uninstall |
| [cli.md](cli.md) | Every command, flag, exit code, and the CI preset |
| [config.md](config.md) | `.secularrc.json` reference, precedence rules, `--init` / `--init-ci` scaffolds |
| [rules.md](rules.md) | All rules with severities, the compliance score, policy gates |
| [skipping.md](skip-modes.md) | Auto-detected skips (runtimes, package trees), skip modes, excludes |
| [ai.md](ai.md) | AI adjudication: providers, keys, how classifications fold back |

## Quick start

```bash
# Install — one line, no npm auth (Linux/macOS; Git Bash/WSL on Windows)
curl -fsSL https://raw.githubusercontent.com/HahaAhhDev/secular/master/install.sh | bash

secular scan /path/to/project        # terminal report
secular scan . --ci -o license.sarif # CI gate with SARIF
secular notice .                     # THIRD-PARTY-NOTICES.md
```

No API key is ever needed for `scan`, `notice`, or `cache` — only the optional `secular ai` command uses one.
