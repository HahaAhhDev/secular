/**
 * Walker: finds LICENSE files, dependency manifests, and source headers.
 * Skips artifact directories (node_modules, .git, dist, build, ...).
 */
/** Directories whose contents we skip entirely (build artifacts, VCS, caches). */
export declare const SKIP_DIRS: Set<string>;
/**
 * Third-party source directories (vendor, deps, ...): source files inside are
 * skipped to avoid rescanning dependency code, but license files inside are
 * STILL collected — vendored LICENSE files are exactly what a license scanner
 * needs to find.
 */
export declare const VENDOR_DIRS: Set<string>;
export interface FoundFile {
    abs: string;
    rel: string;
    kind: "license" | "manifest" | "source";
}
export declare function walk(root: string, maxFiles?: number): FoundFile[];
