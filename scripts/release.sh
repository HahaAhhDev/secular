#!/usr/bin/env bash
#
# secular release helper — bump the version, commit, tag, and push.
# Pushing the tag triggers .github/workflows/release.yml, which builds,
# tests, and publishes @hahaahhdev/secular to GitHub Packages.
#
# Usage:
#   ./scripts/release.sh patch   # 1.0.0 -> 1.0.1
#   ./scripts/release.sh minor   # 1.0.0 -> 1.1.0
#   ./scripts/release.sh major   # 1.0.0 -> 2.0.0
#   ./scripts/release.sh 1.2.3   # explicit version

set -euo pipefail

BUMP="${1:-}"
[ -z "$BUMP" ] && { echo "usage: $0 <patch|minor|major|x.y.z>"; exit 2; }

# Working tree must be clean and in sync before releasing.
[ -z "$(git status --porcelain)" ] || { echo "error: working tree not clean"; exit 1; }
git fetch origin --quiet
BRANCH="$(git rev-parse --abbrev-ref HEAD)"
[ "$(git rev-parse HEAD)" = "$(git rev-parse "origin/$BRANCH")" ] || {
  echo "error: $BRANCH is not in sync with origin/$BRANCH"; exit 1;
}

OLD="$(node -p "require('./package.json').version")"
NEW="$(npm version "$BUMP" --no-git-tag-version --no-commit-hooks)"   # prints v1.2.3
NEW="${NEW#v}"

echo "version: $OLD -> $NEW"

# Rebuild + run the test suite against the new version before tagging.
npm run build >/dev/null
npm test >/dev/null 2>&1 || { echo "error: tests failed — reverting version bump"; npm version "$OLD" --no-git-tag-version >/dev/null; exit 1; }

git add package.json package-lock.json
git commit -m "release v$NEW"
git tag "v$NEW"

echo
echo "Ready to release v$NEW:"
echo "  git push origin $BRANCH v$NEW"
echo
echo "Pushing the tag runs the release workflow (build, test, publish)."
read -r -p "Push now? [y/N] " answer
if [ "${answer,,}" = "y" ]; then
  git push origin "$BRANCH" "v$NEW"
  echo "v$NEW pushed — check the Actions tab for the release run."
else
  echo "Not pushed. When ready: git push origin $BRANCH v$NEW"
fi
