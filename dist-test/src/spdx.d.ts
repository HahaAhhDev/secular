export declare const CACHE_DIR: string;
export declare const LICENSES_JSON: string;
export interface SpdxLicense {
    licenseId: string;
    name: string;
    licenseText?: string;
    isOsiApproved?: boolean;
    isDeprecatedLicenseId?: boolean;
    seeAlso?: string[];
}
export interface SpdxCatalog {
    licenseListVersion: string;
    licenses: SpdxLicense[];
}
/**
 * Load the SPDX license catalog. Uses a local cache (~/.secular/spdx) with a
 * one-week TTL; falls back to a stale cache when offline.
 */
export declare function loadCatalog(opts?: {
    refresh?: boolean;
}): Promise<SpdxCatalog>;
