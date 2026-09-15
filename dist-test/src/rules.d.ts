/**
 * Rules engine: given discovered licenses and project context, produce
 * findings with severity and actionable guidance.
 */
import { type Category } from "./meta.js";
export type Severity = "critical" | "error" | "warning" | "info";
export interface Finding {
    rule: string;
    severity: Severity;
    title: string;
    detail: string;
    license?: string;
    file?: string;
    remediation: string;
}
export interface ScanContext {
    /** Categories of licenses used by the project's own first-party code. */
    projectLicenses: Map<string, {
        category: Category;
        file?: string;
    }>;
    /** All third-party licenses discovered. */
    thirdParty: Map<string, {
        category: Category;
        files: string[];
    }>;
    /** true when the project looks proprietary/closed-source. */
    proprietary: boolean;
    /** true when the project looks like it ships a network service (AGPL relevance). */
    networkService: boolean;
    /** true when a NOTICE/THIRD-PARTY/LEGAL attribution file exists. */
    hasNoticeFile?: boolean;
}
export declare function severityRank(s: Severity): number;
export declare function evaluate(ctx: ScanContext): Finding[];
export declare function complianceScore(findings: Finding[]): number;
