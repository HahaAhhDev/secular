# Configuration file

Options can live in a JSON config so every scan in a directory tree uses the same policy.

## Where secular looks

1. `--config <file>` (explicit path)
2. `$SECULAR_RC` (env var path)
3. `./.secularrc.json` (current working directory)

The first file that exists wins. CLI flags are applied on top — **the command line always beats the config**.

## Example

```json
{
  "exclude": ["fixtures", "testdata"],
  "excludeFile": ["chalk.d.ts"],
  "denyLicense": ["SSPL-1.0"],
  "allowLicense": ["MIT", "ISC"],
  "failOnCategory": ["strong-copyleft"],
  "minSeverity": "warning",
  "skipMode": "auto",
  "strict": true,
  "format": "terminal"
}
```

## Accepted keys

| Key | Type | Maps to flag |
|---|---|---|
| `exclude` | string[] | `--exclude` |
| `excludeFile` | string[] | `--exclude-file` |
| `failOnRule` | string[] | `--fail-on-rule` |
| `failOnCategory` | string[] | `--fail-on-category` |
| `allowLicense` | string[] | `--allow-license` |
| `denyLicense` | string[] | `--deny-license` |
| `minSeverity` | string | `--min-severity` |
| `skipMode` | string | `--skip-mode` |
| `format` | string | `--format` |
| `strict` / `quiet` / `summary` / `failOnUnknown` / `depAudit` / `noVendorScan` / `includeHidden` | boolean | same-name flags |
| `minScore` | number (0–1] | `--min-score` |
| `failOnScore` | number [0–100] | `--fail-on-score` |
| `maxFiles` | positive integer | `--max-files` |
| `timeout` | positive number | `--timeout` |

Invalid values are warned about and skipped — a broken config never fails a scan.

## Notes

- Array keys (`exclude`, `denyLicense`, …) are **replaced** when the corresponding flag is given on the CLI, not merged. `--exclude build` means *only* `build`, regardless of the config.
- `$schema` keys and unknown keys are ignored.

## Scaffolds

```bash
secular --init      # create .secularrc.json (refuses to overwrite)
secular --init-ci   # create .github/workflows/secular.yml for GitHub Actions
```

The generated workflow installs secular from GitHub Packages using the built-in `GITHUB_TOKEN`, runs `secular scan . --ci -o license.sarif`, and uploads the SARIF to GitHub Code Scanning.
