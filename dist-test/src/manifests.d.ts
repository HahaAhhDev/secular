/**
 * Dependency manifest parsing. Extracts declared license fields where present
 * (license notes) and, critically, the DEPENDENCY LISTS that need attribution.
 */
export interface Dep {
    name: string;
    scope: "dependency" | "dev";
    ecosystem: string;
    /** Declared license in the manifest, if the ecosystem records one. */
    declaredLicense?: string;
    source: string;
}
export declare function parsePackageJson(abs: string, source: string): Dep[];
export declare function parseCargoToml(abs: string, source: string): Dep[];
export declare function parseGoMod(abs: string, source: string): Dep[];
export declare function parsePyproject(abs: string, source: string): Dep[];
export declare function parseGemfile(abs: string, source: string): Dep[];
export declare function parseComposerJson(abs: string, source: string): Dep[];
