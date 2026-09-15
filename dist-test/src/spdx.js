import fs from "node:fs";
import path from "node:path";
import os from "node:os";
/** Allow tests/sandboxes to redirect the cache (e.g. tmp dirs). */
const cacheRoot = process.env.SECULAR_HOME ?? os.homedir();
export const CACHE_DIR = path.join(cacheRoot, ".secular", "spdx");
export const LICENSES_JSON = path.join(CACHE_DIR, "licenses.json");
/**
 * spdx-license-list@6 `spdx-full.json` ships license TEXTS, unlike the SPDX
 * list JSON (metadata only). This is what makes offline fingerprinting work.
 */
const SPDX_FULL_URL = "https://cdn.jsdelivr.net/npm/spdx-license-list@6/spdx-full.json";
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 1 week
function fromFullJson(data) {
    const licenses = Object.entries(data).map(([id, e]) => ({
        licenseId: id,
        name: e.name,
        licenseText: e.licenseText,
        isOsiApproved: e.osiApproved,
        isDeprecatedLicenseId: e.deprecated,
        seeAlso: [e.url],
    }));
    return { licenseListVersion: `spdx-license-list@6 (${licenses.length} texts)`, licenses };
}
/**
 * Load the SPDX license catalog. Uses a local cache (~/.secular/spdx) with a
 * one-week TTL; falls back to a stale cache when offline.
 */
export async function loadCatalog(opts = {}) {
    if (!opts.refresh) {
        const cached = readCache();
        if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS)
            return cached.catalog;
        if (cached)
            return cached.catalog; // stale but better than nothing
    }
    try {
        const res = await fetch(SPDX_FULL_URL, { signal: AbortSignal.timeout(30_000) });
        if (!res.ok)
            throw new Error(`HTTP ${res.status}`);
        const catalog = fromFullJson((await res.json()));
        if (!catalog.licenses.length)
            throw new Error("fetched catalog is empty");
        writeCache({ fetchedAt: Date.now(), catalog });
        return catalog;
    }
    catch (err) {
        const cached = readCache();
        if (cached) {
            if (!opts.refresh)
                return cached.catalog;
            // Explicit refresh: stale cache still beats failing the whole scan.
            console.error(`secular: refresh failed (${err.message}); using cached catalog`);
            return cached.catalog;
        }
        throw new Error(`Could not fetch SPDX catalog (${err.message}) and no local cache exists.` +
            ` Run once with network access, or set SECULAR_HOME to a directory containing .secular/spdx/licenses.json.`);
    }
}
function readCache() {
    try {
        return JSON.parse(fs.readFileSync(LICENSES_JSON, "utf8"));
    }
    catch {
        return null;
    }
}
function writeCache(cache) {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    fs.writeFileSync(LICENSES_JSON, JSON.stringify(cache));
}
