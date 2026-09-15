/**
 * License text fingerprinting: normalized-text matching against the SPDX
 * catalog so that full license files AND inline headers are both detected.
 */
import type { SpdxCatalog, SpdxLicense } from "./spdx.js";
/** Strip copyright years, variable names, whitespace and punctuation, lowercase. */
export declare function normalize(text: string): string;
/** Sliding-window shingle hash set for fuzzy containment checks. */
export declare function shingles(norm: string, k?: number): Set<number>;
export declare function hash(s: string): number;
/** Fraction of `a`'s shingles present in `b` (containment similarity). */
export declare function containment(a: Set<number>, b: Set<number>): number;
export interface FingerprintIndex {
    licenses: {
        id: string;
        name: string;
        norm: string;
        sh: Set<number>;
    }[];
}
export declare function buildIndex(catalog: SpdxCatalog): FingerprintIndex;
export interface FingerprintMatch {
    id: string;
    name: string;
    /** Containment similarity 0..1 */
    score: number;
    /** Text-length similarity 0..1 (1 = identical length) */
    lenSim: number;
    /**
     * True when the candidate's text is substantially longer than the query —
     * the query may be a partial excerpt, so the match is inherently ambiguous.
     */
    partial?: boolean;
    /** True when the matched license id is deprecated by SPDX. */
    deprecated?: boolean;
}
/**
 * Identify the license in a block of text. Returns the best matches whose
 * containment score is within 5% of the top hit.
 */
export declare function identify(text: string, index: FingerprintIndex, deprecatedIds?: Set<string>): FingerprintMatch[];
export declare function licenseTextOf(lic: SpdxLicense): string | undefined;
