/**
 * License text fingerprinting: normalized-text matching against the SPDX
 * catalog so that full license files AND inline headers are both detected.
 */
/** Strip copyright years, variable names, whitespace and punctuation, lowercase. */
export function normalize(text) {
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
export function shingles(norm, k = 8) {
    const words = norm.split(" ");
    const set = new Set();
    for (let i = 0; i + k <= words.length; i++) {
        const s = words.slice(i, i + k).join(" ");
        set.add(hash(s));
    }
    return set;
}
export function hash(s) {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return h >>> 0;
}
/** Fraction of `a`'s shingles present in `b` (containment similarity). */
export function containment(a, b) {
    if (a.size === 0)
        return 0;
    let hit = 0;
    for (const x of a)
        if (b.has(x))
            hit++;
    return hit / a.size;
}
/**
 * Popularity prior: when containment scores tie between near-duplicate SPDX
 * families (MIT vs MIT-0, BSD-3-Clause vs BSD-3-Clause-Clear, GPL-3.0 vs
 * AGPL-1.0 ...), prefer the id in real-world use. Derived from SPDX match
 * frequency data + common package manifests; ordered by observed prevalence.
 */
const COMMON_IDS = [
    "MIT", "Apache-2.0", "GPL-3.0-only", "GPL-2.0-only", "BSD-3-Clause", "BSD-2-Clause",
    "ISC", "MPL-2.0", "Unlicense", "0BSD", "Zlib", "CC0-1.0", "AGPL-3.0-only",
    "LGPL-3.0-only", "LGPL-2.1-only", "GPL-3.0-or-later", "GPL-2.0-or-later",
    "AGPL-3.0-or-later", "BSL-1.0", "EPL-2.0", "EUPL-1.2", "CDDL-1.0", "Artistic-2.0",
    "GPL-1.0-only", "LGPL-2.0-only", "MS-PL", "MS-RL", "NCBI-PD", "Sendmail",
];
const commonRank = (id) => {
    const i = COMMON_IDS.indexOf(id);
    return i === -1 ? COMMON_IDS.length : i;
};
/**
 * Set-level containment: every word of `small` appears somewhere in `big`.
 * Used to detect derived-variant licenses (e.g. MIT-0 is MIT's text with
 * nearly every clause present, minus a couple of words).
 */
function wordSetContained(small, big) {
    const a = new Set(small.split(" "));
    const b = new Set(big.split(" "));
    if (a.size > b.size)
        return false;
    for (const w of a)
        if (!b.has(w))
            return false;
    return true;
}
/** True when all words of `small` appear in `big` in order (subsequence check). */
function subsequence(small, big) {
    if (!small || !big || small.length > big.length)
        return false;
    const words = small.split(" ");
    const hay = big.split(" ");
    let i = 0;
    for (const w of hay) {
        if (w === words[i])
            i++;
        if (i === words.length)
            return true;
    }
    return i === words.length;
}
export function buildIndex(catalog) {
    const out = [];
    for (const lic of catalog.licenses) {
        if (!lic.licenseText)
            continue;
        const norm = normalize(lic.licenseText);
        out.push({ id: lic.licenseId, name: lic.name, norm, sh: shingles(norm) });
    }
    return { licenses: out };
}
/**
 * Identify the license in a block of text. Returns the best matches whose
 * containment score is within 5% of the top hit.
 */
export function identify(text, index, deprecatedIds) {
    const norm = normalize(text);
    if (norm.length < 40)
        return [];
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
        .sort((a, b) => b.score - a.score ||
        commonRank(a.id) - commonRank(b.id) ||
        b.lenSim - a.lenSim ||
        (b.deprecated ? 0 : 1) - (a.deprecated ? 0 : 1) ||
        a.id.localeCompare(b.id));
    const top = scored[0];
    if (!top || top.score < 0.5)
        return [];
    // Prefer non-partial candidates on score ties: when the top hit is a
    // "partial" superset match, an exact-length sibling is more credible.
    const topCandidates = scored.filter((s) => s.score >= top.score - 0.05);
    const confident = topCandidates.filter((s) => !s.partial);
    const winners = confident.length ? confident : topCandidates;
    // Truncation rescue: if the winner's full text is contained inside a longer
    // (partial) sibling — e.g. a truncated MIT file matching MIT-0 because its
    // text is a subset of MIT — the superset is the true license.
    const winner = winners[0];
    if (confident.length && confident.length < topCandidates.length) {
        const supersets = topCandidates.filter((s) => s.partial);
        const winnerNorm = (index.licenses.find((l) => l.id === winner.id)?.norm) ?? "";
        const covered = supersets.find((s) => subsequence(winnerNorm, s.norm));
        if (covered)
            return [covered, ...winners.filter((w) => w.id !== covered.id)].slice(0, 3);
    }
    // Derived-variant disambiguation: some SPDX entries (MIT-0, NIST-PD, ...)
    // are near-subsets of a much more common license. If the winner is an
    // uncommon id whose full text is a strict subsequence of a common license's
    // text, the uncommon id is a red herring — prefer the common license.
    // Also applies when all candidates are partial (short/truncated queries).
    if (commonRank(winner.id) === COMMON_IDS.length && winner.score < 0.95) {
        const w = index.licenses.find((l) => l.id === winner.id);
        if (w) {
            const better = index.licenses.find((l) => l.id !== w.id && commonRank(l.id) < COMMON_IDS.length && wordSetContained(w.norm, l.norm));
            if (better) {
                const promoted = scored.find((s) => s.id === better.id);
                if (promoted)
                    return [promoted, ...winners.filter((x) => x.id !== winner.id)].slice(0, 3);
            }
        }
    }
    return winners.slice(0, 3);
}
export function licenseTextOf(lic) {
    return lic.licenseText;
}
