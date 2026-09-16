# Skip detection & skip modes

Secular auto-detects directories that are not your project's compliance surface and skips them. You control what happens to the detected ones.

## What is auto-detected

| Category | Examples | Behavior |
|---|---|---|
| Package trees | `node_modules`, `site-packages`, `dist-packages`, `__pypackages__`, `Pods`, `bower_components` | Skipped entirely — installed packages' licenses come from the manifest, not the disk |
| Build artifacts | `dist`, `build`, `out`, `target`, `coverage`, `.next`, `.turbo`, `.cache` | Skipped entirely |
| Bundled runtimes | `python-3.12.7`, `cpython-3.12.4+`, `node-v20.11.0`, `jdk-21`, `miniconda3`, `temurin*`, `dotnet-sdk*`, `go1.*` | Skipped entirely |
| Oddly-named runtimes | Any dir whose name smells like a toolchain AND contains an interpreter binary (`python3`, `node.exe`, `libpython3.so`, …) | Skipped entirely |
| Hidden dirs | Anything starting with `.` | Skipped unless `--include-hidden` |
| Vendor dirs | `vendor`, `third_party`, `third-party`, `deps`, `external` | Source code skipped, **license files kept** — vendored licenses are compliance-relevant |

## Skip modes

| Mode | Flag | Behavior |
|---|---|---|
| `auto` (default) | `--skip-mode auto` | Skip detected dirs silently. Safe for CI; identical results everywhere |
| `ask` | `--skip-mode ask` | Print what was detected, prompt once: `[i]gnore / [s]can` (default ignore) |
| `scan` | `--skip-mode scan` or `--scan-all` | Never ask — scan the detected dirs too |

Notes:

- The ask-mode prompt goes to **stderr**, so JSON/SARIF output stays clean
- In ask mode, empty stdin (EOF) or `-y` answers "ignore" automatically — CI can't hang
- Piped input still works: `printf 's\n' | secular scan . --skip-mode ask`
- Set a machine default with `SECULAR_SKIP_MODE=ask|scan|auto`
- `--exclude <dir>` always applies regardless of mode (use it to skip your own dirs)

## Examples

```bash
secular scan .                          # auto: runtimes/packages skipped silently
secular scan . --skip-mode ask          # see what's detected, decide once
secular scan . --scan-all               # scan bundled runtimes too
secular scan . --exclude python3.12     # skip your own named dirs
secular scan . --no-vendor-scan         # don't even look inside vendor/
```

## `--exclude` vs skip modes

`--exclude` is for *your* project's directories (fixtures, generated code) and always wins. Skip modes govern only the auto-detected third-party/runtime directories.
