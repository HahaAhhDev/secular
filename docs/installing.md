# Installing secular

Requires **Node.js ≥ 18** on every route. Routes are listed from simplest to most involved.

## 1. One-line installer (recommended)

```bash
curl -fsSL https://raw.githubusercontent.com/HahaAhhDev/secular/master/install.sh | bash
```

- Downloads a prebuilt tarball from GitHub Releases — no npm, no auth, no git, no build
- Installs to `~/.local` by default; run with `sudo` for a system-wide install (`/usr/local`)
- Pin a version: `SECULAR_VERSION=v1.3.1 ./install.sh`
- Works on Linux, macOS, and Windows (Git Bash or WSL); uses `curl` or `wget`, whichever exists
- If the release asset is unavailable, it falls back to a git clone + build automatically

## 2. npx without installing

```bash
# One-time npm setup for GitHub Packages (requires a GitHub token)
github_token=$(gh auth token)   # or a PAT with read:packages
npm config set @hahaahhdev:registry https://npm.pkg.github.com
npm config set //npm.pkg.github.com/:_authToken="$github_token"

npx @hahaahhdev/secular scan .
```

This is the best route on Windows without WSL: Node runs it natively.

## 3. GitHub Packages global install (least recommended)

Same one-time token setup as above, then:

```bash
npm install -g @hahaahhdev/secular
secular --version
```

Why last: GitHub Packages requires authentication for *every* install, so the token setup is mandatory per machine, and the npm config pins the registry. Prefer the installer.

## 4. From source

```bash
git clone https://github.com/HahaAhhDev/secular.git
cd secular && npm install && npm run build
node dist/cli.js --help
# or: npm link  → `secular` available globally from any directory
```

## Uninstall

```bash
curl -fsSL https://raw.githubusercontent.com/HahaAhhDev/secular/master/uninstall.sh | bash
# npm route:
npm uninstall -g @hahaahhdev/secular
```

## Verifying

```bash
secular --version
secular scan /path/to/project
```
