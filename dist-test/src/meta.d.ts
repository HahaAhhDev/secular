/**
 * Metadata for licenses Secular understands out of the box: how copyleft they are,
 * whether they're compatible with proprietary use, and what their obligations are.
 * This drives the rules engine; the SPDX catalog supplies the long tail.
 */
export type Category = "public-domain" | "permissive" | "weak-copyleft" | "strong-copyleft" | "network-copyleft" | "unfree" | "unknown";
export interface LicenseMeta {
    id: string;
    category: Category;
    /** Short human-readable obligations summary. */
    obligations: string;
    /** True if the license text is known to be non-OSI / non-open (e.g. SSPL, BSL pre-conversion). */
    notable?: string;
}
export declare function getMeta(id: string): LicenseMeta;
export declare function categoryLabel(c: Category): string;
