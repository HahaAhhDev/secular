/**
 * Scan orchestration: walk the repo, identify licenses, parse manifests,
 * apply rules, and emit a structured report.
 */
import { type FingerprintMatch } from "./detect.js";
import { type SpdxCatalog } from "./spdx.js";
import { type Category } from "./meta.js";
import { type Finding, type ScanContext } from "./rules.js";
import { type Dep } from "./manifests.js";
export interface LicenseHit {
    file: string;
    matches: FingerprintMatch[];
    /** Best match id, if confident. */
    id?: string;
    score?: number;
    excerpt: string;
}
export interface ScanReport {
    root: string;
    filesScanned: number;
    licenseFiles: LicenseHit[];
    projectLicenses: Map<string, {
        category: Category;
        file?: string;
    }>;
    thirdParty: Map<string, {
        category: Category;
        files: string[];
    }>;
    dependencies: Dep[];
    findings: Finding[];
    score: number;
    catalogVersion: string;
    usedAi: boolean;
}
export interface ScanOptions {
    root: string;
    /** Pre-loaded catalog (avoids refetching in tests). */
    catalog?: SpdxCatalog;
    refreshCatalog?: boolean;
    /** Proprietary assumption — defaults to heuristic. */
    proprietary?: boolean;
}
export declare function scan(opts: ScanOptions): Promise<ScanReport>;
/** Shared context builder so CLI re-evaluation matches scan-time logic exactly. */
export declare function buildContext(input: {
    projectLicenses: ScanContext["projectLicenses"];
    thirdParty: ScanContext["thirdParty"];
    proprietary: boolean;
    root: string;
}): ScanContext;
export declare function heuristicNetworkService(root: string): boolean;
