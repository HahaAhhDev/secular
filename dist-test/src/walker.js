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
const SOURCE_EXT = new Set([
    ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".py", ".rb", ".go", ".rs",
    ".c", ".h", ".cpp", ".hpp", ".cc", ".java", ".kt", ".swift", ".m", ".mm",
    ".cs", ".php", ".sh", ".bash", ".zsh", ".lua", ".pl", ".ex", ".exs",
    ".erl", ".hrl", ".clj", ".cljs", ".scala", ".dart", ".zig", ".vue", ".svelte",
]);
export function walk(root, maxFiles = 50_000) {
    const out = [];
    // Queue entries carry the vendor context: inside a vendor dir we collect
    // license files only.
    const queue = [{ dir: root, inVendor: false }];
    while (queue.length && out.length < maxFiles) {
        const { dir, inVendor } = queue.shift();
        let entries;
        try {
            entries = fs.readdirSync(dir, { withFileTypes: true });
        }
        catch {
            continue;
        }
        for (const e of entries) {
            const abs = path.join(dir, e.name);
            if (e.isDirectory()) {
                if (SKIP_DIRS.has(e.name) || e.name.startsWith("."))
                    continue;
                queue.push({ dir: abs, inVendor: inVendor || VENDOR_DIRS.has(e.name) });
                continue;
            }
            if (!e.isFile())
                continue;
            const rel = path.relative(root, abs);
            const base = e.name;
            if (LICENSE_FILE_RE.test(base))
                out.push({ abs, rel, kind: "license" });
            else if (inVendor)
                continue; // vendor source code: skip
            else if (isManifest(base))
                out.push({ abs, rel, kind: "manifest" });
            else if (SOURCE_EXT.has(path.extname(e.name)))
                out.push({ abs, rel, kind: "source" });
        }
    }
    return out;
}
function isManifest(base) {
    if (MANIFEST_FILES.has(base))
        return true;
    if (base.endsWith(".csproj"))
        return true;
    return false;
}
