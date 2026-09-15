/**
 * Walker: finds LICENSE files, dependency manifests, and source headers.
 * Respects .gitignore-lite rules (node_modules, .git, dist, build, vendor...).
 */

import fs from "node:fs";
import path from "node:path";

export const SKIP_DIRS = new Set([
  "node_modules", ".git", ".hg", ".svn", "dist", "build", "out", "target",
  "vendor", ".next", ".nuxt", ".venv", "venv", "__pycache__", ".tox",
  "coverage", ".turbo", ".cache", ".parcel-cache", "bower_components",
  "jspm_packages", ".gradle", ".mvn", "Pods", "DerivedData",
]);

const LICENSE_FILE_RE = /^(?:UN)?LICEN[CS]E(?:[.\-_ ][A-Za-z0-9]+)*$|^(?:UN)?LICEN[CS]E[.\-_ ]|COPYING|NOTICE|COPYRIGHT|PATENTS|AUTHORS|THIRD[-_ ]?PARTY|LEGAL/i;
const MANIFEST_FILES = new Set([
  "package.json", "package-lock.json", "yarn.lock", "pnpm-lock.yaml", "bun.lockb",
  "Cargo.toml", "Cargo.lock", "go.mod", "go.sum", "pyproject.toml", "setup.py",
  "setup.cfg", "requirements.txt", "Pipfile", "Pipfile.lock", "poetry.lock",
  "Gemfile", "Gemfile.lock", "composer.json", "composer.lock", "pom.xml",
  "build.gradle", "build.gradle.kts", "mix.exs", "mix.lock", "shard.yml",
  "packages.lock.json", "*.csproj", "DESCRIPTION", "pubspec.yaml",
]);

export interface FoundFile {
  abs: string;
  rel: string;
  kind: "license" | "manifest" | "source";
}

const SOURCE_EXT = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".py", ".rb", ".go", ".rs",
  ".c", ".h", ".cpp", ".hpp", ".cc", ".java", ".kt", ".swift", ".m", ".mm",
  ".cs", ".php", ".sh", ".bash", ".zsh", ".lua", ".pl", ".ex", ".exs",
  ".erl", ".hrl", ".clj", ".cljs", ".scala", ".dart", ".zig", ".vue", ".svelte",
]);

export function walk(root: string, maxFiles = 50_000): FoundFile[] {
  const out: FoundFile[] = [];
  const queue: string[] = [root];
  while (queue.length && out.length < maxFiles) {
    const dir = queue.shift()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name) && !e.name.startsWith(".")) queue.push(abs);
        continue;
      }
      if (!e.isFile()) continue;
      const rel = path.relative(root, abs);
      const base = path.basename(e.name);
      if (LICENSE_FILE_RE.test(base)) out.push({ abs, rel, kind: "license" });
      else if (isManifest(base)) out.push({ abs, rel, kind: "manifest" });
      else if (SOURCE_EXT.has(path.extname(e.name))) out.push({ abs, rel, kind: "source" });
    }
  }
  return out;
}

function isManifest(base: string): boolean {
  if (MANIFEST_FILES.has(base)) return true;
  if (base.endsWith(".csproj")) return true;
  return false;
}
