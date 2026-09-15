/**
 * Walker: finds LICENSE files, dependency manifests, and source headers.
 * Skips artifact directories (node_modules, .git, dist, build, ...).
 */

import fs from "node:fs";
import path from "node:path";

/** Directories whose contents we skip entirely (build artifacts, VCS, caches). */
export const SKIP_DIRS = new Set([
  "node_modules", ".git", ".hg", ".svn", "dist", "build", "out", "target",
  ".next", ".nuxt", ".venv", "venv", "__pycache__", ".tox",
  "coverage", ".turbo", ".cache", ".parcel-cache", "bower_components",
  "jspm_packages", ".gradle", ".mvn", "Pods", "DerivedData",
]);

/**
 * Third-party source directories (vendor, deps, ...): source files inside are
 * skipped to avoid rescanning dependency code, but license files inside are
 * STILL collected — vendored LICENSE files are exactly what a license scanner
 * needs to find.
 */
export const VENDOR_DIRS = new Set(["vendor", "third_party", "third-party", "deps", "external"]);

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

export interface WalkOptions {
  /** Directory names (any depth) to skip entirely. Case-insensitive. */
  exclude?: string[];
}

function shouldExclude(name: string, exclude?: string[]): boolean {
  if (!exclude?.length) return false;
  const lower = name.toLowerCase();
  return exclude.some((e) => {
    const el = e.toLowerCase();
    // "foo" matches the directory foo; "foo/" also accepted for convenience
    return lower === el.replace(/\/+$/, "");
  });
}

export function walk(root: string, maxFiles = 50_000, opts: WalkOptions = {}): FoundFile[] {
  const out: FoundFile[] = [];
  // Visited real paths guard against symlink loops (a→b→a).
  const visited = new Set<string>([fs.realpathSync.native(root)]);
  // Queue entries carry the vendor context: inside a vendor dir we collect
  // license files only.
  const queue: { dir: string; rel: string; inVendor: boolean }[] = [{ dir: root, rel: "", inVendor: false }];
  while (queue.length && out.length < maxFiles) {
    const { dir, rel: parentRel, inVendor } = queue.shift()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const rel = parentRel ? `${parentRel}/${e.name}` : e.name;
      if (e.isDirectory() || e.isSymbolicLink()) {
        const abs = path.join(dir, e.name);
        if (e.isDirectory()) {
          if (SKIP_DIRS.has(e.name) || e.name.startsWith(".")) continue;
          if (shouldExclude(e.name, opts.exclude)) continue;
        } else {
          // Symlink: follow only when it points at a directory.
          let st: fs.Stats;
          try {
            st = fs.statSync(abs);
          } catch {
            continue; // broken symlink
          }
          if (!st.isDirectory()) continue;
          if (SKIP_DIRS.has(e.name) || e.name.startsWith(".") || shouldExclude(e.name, opts.exclude)) continue;
        }
        // Symlink loop guard: resolve and skip already-visited directories.
        let real: string;
        try {
          real = fs.realpathSync.native(abs);
        } catch {
          continue; // unreadable / broken symlink
        }
        if (visited.has(real)) continue;
        visited.add(real);
        queue.push({ dir: abs, rel, inVendor: inVendor || VENDOR_DIRS.has(e.name) });
        continue;
      }
      if (!e.isFile()) continue;
      const base = e.name;
      if (LICENSE_FILE_RE.test(base)) out.push({ abs: path.join(dir, base), rel, kind: "license" });
      else if (inVendor) continue; // vendor source code: skip
      else if (isManifest(base)) out.push({ abs: path.join(dir, base), rel, kind: "manifest" });
      else if (SOURCE_EXT.has(path.extname(base))) out.push({ abs: path.join(dir, base), rel, kind: "source" });
    }
  }
  return out;
}

function isManifest(base: string): boolean {
  if (MANIFEST_FILES.has(base)) return true;
  if (base.endsWith(".csproj")) return true;
  return false;
}
