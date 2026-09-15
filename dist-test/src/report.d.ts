/**
 * Reporting: human terminal output, machine formats (JSON, Markdown, SARIF),
 * and THIRD-PARTY-NOTICES generation.
 */
import type { ScanReport } from "./scan.js";
export declare function terminal(r: ScanReport): string;
export declare function toJson(r: ScanReport): string;
export declare function toMarkdown(r: ScanReport): string;
export declare function toSarif(r: ScanReport): string;
/** Generate THIRD-PARTY-NOTICES.md from the report. */
export declare function toNotices(r: ScanReport): string;
