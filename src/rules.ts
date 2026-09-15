/**
 * Rules engine: given discovered licenses and project context, produce
 * findings with severity and actionable guidance.
 */

import { getMeta, categoryLabel, type Category } from "./meta.js";

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
  projectLicenses: Map<string, { category: Category; file?: string }>;
  /** All third-party licenses discovered. */
  thirdParty: Map<string, { category: Category; files: string[] }>;
  /** true when the project looks proprietary/closed-source. */
  proprietary: boolean;
  /** true when the project looks like it ships a network service (AGPL relevance). */
  networkService: boolean;
  /** true when a NOTICE/THIRD-PARTY/LEGAL attribution file exists. */
  hasNoticeFile?: boolean;
}

const ORDER: Record<Severity, number> = { critical: 0, error: 1, warning: 2, info: 3 };

export function severityRank(s: Severity): number {
  return ORDER[s];
}

export function evaluate(ctx: ScanContext): Finding[] {
  const findings: Finding[] = [];

  // ---- Rule: copyleft dependency inside proprietary project ----
  if (ctx.proprietary) {
    for (const [id, info] of ctx.thirdParty) {
      const meta = getMeta(id);
      if (meta.category === "strong-copyleft") {
        findings.push({
          rule: "COPYLEFT-IN-PROPRIETARY",
          severity: "critical",
          title: `Strong copyleft license "${id}" found in a proprietary codebase`,
          detail: `${id} is ${categoryLabel(meta.category)}. If you link or distribute this code, GPL obligations apply to the combined work.`,
          license: id,
          file: info.files[0],
          remediation: `Remove/replace the dependency, isolate it behind a separate process (GPL boundary), or open-source the combined work under ${id}.`,
        });
      } else if (meta.category === "network-copyleft") {
        const net = ctx.networkService || meta.id.startsWith("AGPL") || meta.id.startsWith("EUPL") || meta.id === "OSL-3.0";
        findings.push({
          rule: net ? "NETWORK-COPYLEFT" : "COPYLEFT-IN-PROPRIETARY",
          severity: "critical",
          title: `Network copyleft license "${id}" found`,
          detail: `${id}: ${meta.obligations}${ctx.networkService ? " Your project looks like a network service, so AGPL/EUPL-style source-disclosure obligations are most likely triggered." : ""}`,
          license: id,
          file: info.files[0],
          remediation: "Isolate via separate process, negotiate commercial licensing, or replace.",
        });
      } else if (meta.category === "unfree") {
        findings.push({
          rule: "NON-OPEN-LICENSE",
          severity: "critical",
          title: `Non-open license "${id}" detected`,
          detail: `${id}: ${meta.obligations}${meta.notable ? ` Note: ${meta.notable}.` : ""}`,
          license: id,
          file: info.files[0],
          remediation: "Remove or obtain a commercial license from the rights holder.",
        });
      } else if (meta.category === "weak-copyleft") {
        findings.push({
          rule: "WEAK-COPYLEFT",
          severity: "warning",
          title: `Weak copyleft license "${id}" found`,
          detail: `${id}: ${meta.obligations}`,
          license: id,
          file: info.files[0],
          remediation: "Disclose modifications to licensed files; typically fine for proprietary use if unmodified code is used as a library.",
        });
      }
    }
  }

  // ---- Rule: project's own license is copyleft but code looks closed ----
  for (const [id, info] of ctx.projectLicenses) {
    const meta = getMeta(id);
    if (meta.category === "strong-copyleft" && ctx.proprietary) {
      findings.push({
        rule: "PROJECT-LICENSE-CONFLICT",
        severity: "error",
        title: `Project declares ${id} but appears proprietary`,
        detail: `Your root LICENSE is ${categoryLabel(meta.category)}, yet the repo shows signs of a proprietary project (no forkable repo hints, copyright holders, etc.). Verify intent.`,
        license: id,
        file: info.file,
        remediation: `If this is intentional open source, fine. If the project is actually proprietary, the ${id} LICENSE file is a liability — remove or change it.`,
      });
    }
    if (meta.category === "unfree") {
      findings.push({
        rule: "PROJECT-LICENSE-UNFREE",
        severity: "error",
        title: `Project's own license "${id}" restricts use`,
        detail: `${id}: ${meta.obligations}${meta.notable ? ` Note: ${meta.notable}.` : ""}`,
        license: id,
        file: info.file,
        remediation: "Confirm this is intentional (e.g. source-available) and that it matches your distribution model.",
      });
    }
  }

  // ---- Rule: unknown/unidentifiable license text ----
  const unknown = [...ctx.thirdParty.entries()].filter(([id]) => getMeta(id).category === "unknown");
  for (const [id, info] of unknown) {
    findings.push({
      rule: "UNKNOWN-LICENSE",
      severity: "warning",
      title: `License "${id}" could not be classified`,
      detail: "Secular's local catalog doesn't recognize this license. AI adjudication can usually resolve it.",
      license: id,
      file: info.files[0],
      remediation: "Run with an API key so the AI layer can adjudicate, or classify manually.",
    });
  }

  // ---- Rule: missing NOTICE / attribution file when attribution licenses exist ----
  const attributionNeeded = [...ctx.thirdParty.keys()].filter((id) =>
    ["MIT", "ISC", "BSD-2-Clause", "BSD-3-Clause", "Apache-2.0", "Zlib", "BSL-1.0"].includes(id)
  );
  if (attributionNeeded.length > 0 && ctx.proprietary && !ctx.hasNoticeFile) {
    findings.push({
      rule: "MISSING-NOTICE",
      severity: "info",
      title: "Attribution licenses present but no NOTICE/THIRD-PARTY file found",
      detail: `${attributionNeeded.length} permissive license(s) require keeping copyright + license text with distributions.`,
      remediation: "Run `secular notice` to generate a THIRD-PARTY-NOTICES file.",
    });
  }

  return findings.sort((a, b) => severityRank(a.severity) - severityRank(b.severity));
}

export function complianceScore(findings: Finding[]): number {
  const penalty = findings.reduce((acc, f) => {
    switch (f.severity) {
      case "critical": return acc + 30;
      case "error": return acc + 15;
      case "warning": return acc + 5;
      case "info": return acc + 1;
    }
  }, 0);
  return Math.max(0, 100 - penalty);
}
