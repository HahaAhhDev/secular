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

/**
 * Package-manager-managed dependency trees: skipped ENTIRELY, licenses
 * included. These hold installed copies of published packages whose licenses
 * are not this project's compliance surface (they come from the manifest,
 * not the disk). Vendored code in `vendor/` etc. is different — those are
 * checked in and DO get their licenses scanned.
 */
export const MODULE_DIRS = new Set([
  "node_modules", "site-packages", "dist-packages", "__pypackages__",
  "jspm_packages", "bower_components", "Pods", "rust_packages",
]);

/** Directory names that are almost certainly an interpreter/runtime install. */
const RUNTIME_DIR_RE =
  /^(?:python-?\d+(?:\.\d+)*|python\d{2,}|cpython-?\d[\w.+-]*|pypy-?\d[\w.+-]*|node-?v?\d+[\w.]*|iojs-?v?\d+[\w.]*|jdk-?\d[\w.+-]*|jre-?\d[\w.+-]*|openjdk[\w.+-]*|temurin[\w.+-]*|dotnet(?:-sdk)?-?\d[\w.+-]*|mono-?\d[\w.+-]*|(?:micro|mini|ana)mamba\d*|miniconda\d*|anaconda\d*|conda-?\d[\w.+-]*|ruby-?\d[\w.+-]*|php-?\d[\w.+-]*|go1[\w.+-]*|rust-?\d[\w.+-]*|erlang-?\d[\w.+-]*|elixir-?\d[\w.+-]*)$/i;

/** Looser smell used to trigger a cheap content check for runtime installs. */const TOOLCHAIN_SMELL_RE = /(?:py|python|node|jdk|jre|ruby|php|dotnet|mono|conda|mamba|erlang|elixir|rust|swift|perl|tcl)[-_ a-z]*\d/i;

/**
 * Content-based runtime detection: a directory that *contains* an interpreter
 * (bin/python3, lib/libpython3.so, python.exe, node.exe, ...) is a runtime
 * install regardless of its name. Only called for names that smell like a
 * toolchain, so normal project dirs pay no cost.
 */
function looksLikeRuntimeInstall(abs: string): boolean {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(abs, { withFileTypes: true });
  } catch {
    return false;
  }
  return entries.some((e) =>
    /^(?:python\d?(?:\.exe)?|python3(?:\.\d+)?(?:\.exe)?|node(?:\.exe)?|java(?:\.exe)?|dotnet(?:\.exe)?|ruby(?:\.exe)?|php(?:\.exe)?)$/i.test(e.name) ||
    /^libpython\d/i.test(e.name) ||
    (e.isDirectory() && (e.name === "bin" || e.name === "lib") && runtimeSignatureIn(path.join(abs, e.name))) ||
    /^python\d+(?:\._pth|\d+\.dll|\d+\.zip)$/i.test(e.name) ||
    /^LICENSE\.PYTHON$/i.test(e.name),
  );
}

function runtimeSignatureIn(dir: string): boolean {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return false;
  }
  return entries.some((e) => /^(?:python\d?(?:\.\d+)?(?:\.exe)?|node(?:\.exe)?|libpython\d|python\d+\.dll)$/i.test(e.name));
}

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

/** A directory the walker wants to skip, with the reason it was detected. */
export interface SkippedDir {
  rel: string;
  /** Why it was flagged: known artifact/package/runtime name, or content sniff. */
  reason: "package-tree" | "build-artifact" | "runtime" | "hidden" | "excluded";
}

/**
 * What the walker should do with auto-detected skip candidates:
 * - "auto" (default): skip silently — current behavior, safe for CI.
 * - "scan": include them (user opted to scan everything).
 * - "ask": collect candidates and let the caller decide (interactive).
 */
export type SkipMode = "auto" | "scan" | "ask";

const SOURCE_EXT = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".py", ".rb", ".go", ".rs",
  ".c", ".h", ".cpp", ".hpp", ".cc", ".java", ".kt", ".swift", ".m", ".mm",
  ".cs", ".php", ".sh", ".bash", ".zsh", ".lua", ".pl", ".ex", ".exs",
  ".erl", ".hrl", ".clj", ".cljs", ".scala", ".dart", ".zig", ".vue", ".svelte",
]);

export interface WalkOptions {
  /** Directory names (any depth) to skip entirely. Case-insensitive. */
  exclude?: string[];
  /** File basenames to skip entirely. Case-insensitive. */
  excludeFiles?: string[];
  /** Also scan license files inside vendor dirs' source tree (default on). */
  noVendorScan?: boolean;
  /** Also descend into hidden directories (default off). */
  includeHidden?: boolean;
  /** What to do with auto-detected skip candidates. Default "auto". */
  skipMode?: SkipMode;
  /** Output for "ask" mode: detected candidates are reported here. Return null to scan them all instead. */
  onSkippedDetected?: (skipped: SkippedDir[]) => SkippedDir[] | null | void;
}

export function classifySkip(name: string, abs: string): SkippedDir["reason"] | null {
  if (MODULE_DIRS.has(name)) return "package-tree";
  if (SKIP_DIRS.has(name)) return "build-artifact";
  if (name.startsWith(".")) return "hidden";
  if (VENDOR_DIRS.has(name)) return null;
  if (RUNTIME_DIR_RE.test(name)) return "runtime";
  if (TOOLCHAIN_SMELL_RE.test(name) && looksLikeRuntimeInstall(abs)) return "runtime";
  return null;
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
  const skipMode: SkipMode = opts.skipMode ?? "auto";
  const detected: SkippedDir[] = [];
  // User --exclude always applies regardless of mode.
  const exclude = opts.exclude;
  const excludeFiles = opts.excludeFiles?.map((e) => e.toLowerCase());
  const noVendorScan = opts.noVendorScan === true;
  const includeHidden = opts.includeHidden === true;
  // Visited real paths guard against symlink loops (a→b→a).
  const visited = new Set<string>([fs.realpathSync.native(root)]);
  // Queue entries carry the vendor context: inside a vendor dir we collect
  // license files only. Bounded to keep scans on pathological trees (deeply
  // nested generated dirs) from exhausting memory.
  const MAX_DEPTH = 64;
  const queue: { dir: string; rel: string; inVendor: boolean; depth: number }[] = [
    { dir: root, rel: "", inVendor: false, depth: 0 },
  ];
  while (queue.length && out.length < maxFiles) {
    const { dir, rel: parentRel, inVendor, depth } = queue.shift()!;
    if (depth > MAX_DEPTH) continue;
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
        let isDir = e.isDirectory();
        if (!isDir) {
          // Symlink: follow only when it points at a directory.
          let st: fs.Stats;
          try {
            st = fs.statSync(abs);
          } catch {
            continue; // broken symlink
          }
          if (!st.isDirectory()) continue;
          isDir = true;
        }
        if (shouldExclude(e.name, exclude)) continue;
        if (includeHidden && e.name.startsWith(".")) {
          // --include-hidden: hidden dirs enter the queue like normal dirs,
          // skipping only VCS-internal ones that would recurse absurdly.
          if (e.name === ".git" || e.name === ".hg" || e.name === ".svn") continue;
        } else {
          const reason = classifySkip(e.name, abs);
          if (reason) {
            if (skipMode === "scan") {
              // User chose to scan detected candidates: fall through.
            } else if (skipMode === "ask") {
              detected.push({ rel, reason });
              continue; // tentatively skipped; caller may rescan
            } else {
              continue; // auto: skip silently
            }
          }
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
        queue.push({ dir: abs, rel, inVendor: inVendor || VENDOR_DIRS.has(e.name), depth: depth + 1 });
        continue;
      }
      if (!e.isFile()) continue;
      const base = e.name;
      if (excludeFiles?.includes(base.toLowerCase())) continue;
      if (noVendorScan && inVendor) continue; // --no-vendor-scan: skip everything under vendor
      if (LICENSE_FILE_RE.test(base)) out.push({ abs: path.join(dir, base), rel, kind: "license" });
      else if (inVendor) continue; // vendor source code: skip
      else if (isManifest(base)) out.push({ abs: path.join(dir, base), rel, kind: "manifest" });
      else if (SOURCE_EXT.has(path.extname(base))) out.push({ abs: path.join(dir, base), rel, kind: "source" });
    }
  }
  if (skipMode === "ask" && detected.length && opts.onSkippedDetected) {
    const decision = opts.onSkippedDetected(detected);
    if (decision === null) {
      // Caller chose "scan": re-run with everything included.
      return walk(root, maxFiles, { ...opts, skipMode: "scan" });
    }
  }
  lastSkipped = detected;
  return out;
}

/** Populated after walk() runs in "ask" mode: what was detected/skipped. */
export let lastSkipped: SkippedDir[] = [];
export function resetLastSkipped(): void {
  lastSkipped = [];
}

function isManifest(base: string): boolean {
  if (MANIFEST_FILES.has(base)) return true;
  if (base.endsWith(".csproj")) return true;
  return false;
}
