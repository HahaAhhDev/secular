/**
 * License text fingerprinting: normalized-text matching against the SPDX
 * catalog so that full license files AND inline headers are both detected.
 */

import type { SpdxCatalog, SpdxLicense } from "./spdx.js";

/** Strip copyright years, variable names, whitespace and punctuation, lowercase. */
export function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/copyright\s+(?:©|\(c\)|\u00a9)?\s*\d{4}(?:\s*[-,\u2013]\s*\d{4})*/g, " ")
    .replace(/(?:©|\(c\)|\u00a9)\s*\d{4}(?:\s*[-,\u2013]\s*\d{4})*/g, " ")
    .replace(/\d{4}/g, " ")
    .replace(/\[[<>a-z0-9 .@_-]+\]|\{[<>a-z0-9 .@_-]+\}|<[a-z0-9 .@_-]+>|<<[a-z0-9 .@_-]+>>/gi, " ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Sliding-window shingle hash set for fuzzy containment checks. */
export function shingles(norm: string, k = 8): Set<number> {
  const words = norm.split(" ");
  const set = new Set<number>();
  for (let i = 0; i + k <= words.length; i++) {
    const s = words.slice(i, i + k).join(" ");
    set.add(hash(s));
  }
  return set;
}

export function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Fraction of `a`'s shingles present in `b` (containment similarity). */
export function containment(a: Set<number>, b: Set<number>): number {
  if (a.size === 0) return 0;
  let hit = 0;
  for (const x of a) if (b.has(x)) hit++;
  return hit / a.size;
}

export interface FingerprintIndex {
  licenses: { id: string; name: string; norm: string; sh: Set<number> }[];
}

export function buildIndex(catalog: SpdxCatalog): FingerprintIndex {
  const out: FingerprintIndex["licenses"] = [];
  for (const lic of catalog.licenses) {
    if (!lic.licenseText) continue;
    const norm = normalize(lic.licenseText);
    out.push({ id: lic.licenseId, name: lic.name, norm, sh: shingles(norm) });
  }
  return { licenses: out };
}

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
export function identify(
  text: string,
  index: FingerprintIndex,
  deprecatedIds?: Set<string>
): FingerprintMatch[] {
  const norm = normalize(text);
  if (norm.length < 40) return [];
  const sh = shingles(norm);
  const scored = index.licenses
    .map((l) => {
      const lenSim = 1 - Math.abs(l.norm.length - norm.length) / Math.max(l.norm.length, norm.length, 1);
      return {
        id: l.id,
        name: l.name,
        score: containment(sh, l.sh),
        lenSim,
        // Candidate text much longer than the query → the query is likely a
        // partial excerpt; such matches are inherently less trustworthy.
        partial: l.norm.length > norm.length * 1.4,
        deprecated: deprecatedIds?.has(l.id),
      };
    })
    .sort(
      (a, b) =>
        b.score - a.score ||
        b.lenSim - a.lenSim ||
        (b.deprecated ? 0 : 1) - (a.deprecated ? 0 : 1) ||
        a.id.localeCompare(b.id)
    );

  const top = scored[0];
  if (!top || top.score < 0.5) return [];
  // Prefer non-partial candidates on score ties: when the top hit is a
  // "partial" superset match, an exact-length sibling is more credible.
  const topCandidates = scored.filter((s) => s.score >= top.score - 0.05);
  const confident = topCandidates.filter((s) => !s.partial);
  return (confident.length ? confident : topCandidates).slice(0, 3);
}

export function licenseTextOf(lic: SpdxLicense): string | undefined {
  return lic.licenseText;
}
