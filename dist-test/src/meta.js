/**
 * Metadata for licenses Secular understands out of the box: how copyleft they are,
 * whether they're compatible with proprietary use, and what their obligations are.
 * This drives the rules engine; the SPDX catalog supplies the long tail.
 */
const M = {
    MIT: { id: "MIT", category: "permissive", obligations: "Keep copyright + license text in copies." },
    "BSD-2-Clause": { id: "BSD-2-Clause", category: "permissive", obligations: "Keep copyright notice; no names for endorsement." },
    "BSD-3-Clause": { id: "BSD-3-Clause", category: "permissive", obligations: "Keep copyright notice; no names for endorsement." },
    "BSD-4-Clause": { id: "BSD-4-Clause", category: "permissive", obligations: "Like BSD-3 plus non-advertising clause (often considered obsolete)." },
    "Apache-2.0": { id: "Apache-2.0", category: "permissive", obligations: "Keep NOTICE file; state changes; patent grant included." },
    "ISC": { id: "ISC", category: "permissive", obligations: "Keep copyright notice." },
    "0BSD": { id: "0BSD", category: "public-domain", obligations: "None." },
    "Unlicense": { id: "Unlicense", category: "public-domain", obligations: "None." },
    "CC0-1.0": { id: "CC0-1.0", category: "public-domain", obligations: "None." },
    "Zlib": { id: "Zlib", category: "permissive", obligations: "Keep copyright notice." },
    "BSL-1.0": { id: "BSL-1.0", category: "permissive", obligations: "Boost: keep notice; no trademark grant." },
    "MPL-2.0": { id: "MPL-2.0", category: "weak-copyleft", obligations: "File-level copyleft: disclose modified MPL files' source." },
    "LGPL-2.1-only": { id: "LGPL-2.1-only", category: "weak-copyleft", obligations: "Dynamic linking allowed; provide relinkable object files or source." },
    "LGPL-2.1-or-later": { id: "LGPL-2.1-or-later", category: "weak-copyleft", obligations: "Dynamic linking allowed; provide relinkable object files or source." },
    "LGPL-3.0-only": { id: "LGPL-3.0-only", category: "weak-copyleft", obligations: "Like LGPL-2.1 plus GPL-3.0 terms for conveyance." },
    "LGPL-3.0-or-later": { id: "LGPL-3.0-or-later", category: "weak-copyleft", obligations: "Like LGPL-2.1 plus GPL-3.0 terms for conveyance." },
    "EPL-1.0": { id: "EPL-1.0", category: "weak-copyleft", obligations: "File-level copyleft; disclose modified EPL files." },
    "EPL-2.0": { id: "EPL-2.0", category: "weak-copyleft", obligations: "File-level copyleft; disclose modified EPL files." },
    "CDDL-1.0": { id: "CDDL-1.0", category: "weak-copyleft", obligations: "File-level copyleft; disclose modified CDDL files." },
    "CPL-1.0": { id: "CPL-1.0", category: "weak-copyleft", obligations: "File-level copyleft; disclose modified CPL files." },
    "MPL-1.1": { id: "MPL-1.1", category: "weak-copyleft", obligations: "File-level copyleft (deprecated)." },
    "GPL-2.0-only": { id: "GPL-2.0-only", category: "strong-copyleft", obligations: "Distribute source of derivatives under GPL-2.0." },
    "GPL-2.0-or-later": { id: "GPL-2.0-or-later", category: "strong-copyleft", obligations: "Distribute source of derivatives under GPL-2.0+." },
    "GPL-3.0-only": { id: "GPL-3.0-only", category: "strong-copyleft", obligations: "Distribute source of derivatives under GPL-3.0; patent + anti-tivoization clauses." },
    "GPL-3.0-or-later": { id: "GPL-3.0-or-later", category: "strong-copyleft", obligations: "Distribute source of derivatives under GPL-3.0+." },
    "AGPL-3.0-only": { id: "AGPL-3.0-only", category: "network-copyleft", obligations: "GPL-3.0 + network clause: offering as a service triggers source disclosure." },
    "AGPL-3.0-or-later": { id: "AGPL-3.0-or-later", category: "network-copyleft", obligations: "GPL-3.0 + network clause: offering as a service triggers source disclosure." },
    "SSPL-1.0": { id: "SSPL-1.0", category: "unfree", obligations: "Not OSI-approved: hosting as a service requires releasing the entire service stack.", notable: "Commonly excluded from commercial use." },
    "EUPL-1.1": { id: "EUPL-1.1", category: "network-copyleft", obligations: "Strong copyleft with network scope (EU).", },
    "EUPL-1.2": { id: "EUPL-1.2", category: "network-copyleft", obligations: "Strong copyleft with network scope (EU)." },
    "OSL-3.0": { id: "OSL-3.0", category: "network-copyleft", obligations: "Network copyleft: network use counts as distribution." },
    "RPL-1.5": { id: "RPL-1.5", category: "network-copyleft", obligations: "Network copyleft (Reciprocal Public License)." },
    "AGPL-1.0-only": { id: "AGPL-1.0-only", category: "network-copyleft", obligations: "Affero GPL v1 (rare)." },
    "AGPL-1.0-or-later": { id: "AGPL-1.0-or-later", category: "network-copyleft", obligations: "Affero GPL v1 (rare)." },
    "WTFPL": { id: "WTFPL", category: "public-domain", obligations: "None (effectively)." },
    "CC-BY-4.0": { id: "CC-BY-4.0", category: "permissive", obligations: "Attribution required; not recommended for code but common for docs/assets." },
    "CC-BY-SA-4.0": { id: "CC-BY-SA-4.0", category: "weak-copyleft", obligations: "ShareAlike: derivatives must use same license; attribution required." },
    "CC-BY-NC-4.0": { id: "CC-BY-NC-4.0", category: "unfree", obligations: "Non-commercial only — not open source.", notable: "Blocks commercial use." },
    "CC-BY-NC-SA-4.0": { id: "CC-BY-NC-SA-4.0", category: "unfree", obligations: "Non-commercial + ShareAlike — not open source.", notable: "Blocks commercial use." },
    "CC-BY-NC-ND-4.0": { id: "CC-BY-NC-ND-4.0", category: "unfree", obligations: "Non-commercial, no derivatives — not open source.", notable: "Blocks commercial use." },
    "CC-BY-ND-4.0": { id: "CC-BY-ND-4.0", category: "unfree", obligations: "No derivatives — not open source.", notable: "Blocks modification." },
};
export function getMeta(id) {
    // Normalize deprecated SPDX short forms (GPL-3.0+ → GPL-3.0-or-later,
    // GPL-3.0 → GPL-3.0-only, GPL-2.0 → GPL-2.0-only, etc.).
    const canonical = id
        .replace(/^(GPL|LGPL|AGPL)-(\d\.\d)\+$/i, "$1-$2-or-later")
        .replace(/^(GPL|LGPL|AGPL)-(\d\.\d)$/i, "$1-$2-only")
        .replace(/^(GPL|LGPL|AGPL)-\d$/i, "$1-x-only") // not a real id; fallthrough
        .replace(/^(.+)-or-later\+$/i, "$1-or-later");
    const base = canonical.split("+")[0].split(" WITH ")[0];
    return (M[canonical] ??
        M[base] ?? { id, category: "unknown", obligations: "Unknown license — manual review recommended." });
}
export function categoryLabel(c) {
    switch (c) {
        case "public-domain": return "Public domain";
        case "permissive": return "Permissive";
        case "weak-copyleft": return "Weak copyleft";
        case "strong-copyleft": return "Strong copyleft";
        case "network-copyleft": return "Network copyleft";
        case "unfree": return "Non-open";
        case "unknown": return "Unknown";
    }
}
