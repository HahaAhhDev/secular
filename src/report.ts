/**
 * Reporting: human terminal output, machine formats (JSON, Markdown, SARIF),
 * and THIRD-PARTY-NOTICES generation.
 */

import type { ScanReport } from "./scan.js";
import { categoryLabel } from "./meta.js";
import { severityRank, type Finding, type Severity } from "./rules.js";

const C = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  green: "\x1b[32m",
  cyan: "\x1b[36m",
  gray: "\x1b[90m",
};

const SEV_COLOR: Record<Severity, string> = {
  critical: C.red,
  error: C.red,
  warning: C.yellow,
  info: C.cyan,
};

const SEV_ICON: Record<Severity, string> = {
  critical: "\u2717",
  error: "\u25b2",
  warning: "\u26a0",
  info: "\u2139",
};

export function terminal(r: ScanReport): string {
  const L: string[] = [];
  L.push(`${C.bold}Secular\u2122 \u2014 license compliance report${C.reset}`);
  L.push(`${C.gray}${r.root}${C.reset}`);
  L.push("");
  L.push(`Scanned ${r.filesScanned} files \u00b7 SPDX catalog v${r.catalogVersion}${r.usedAi ? " \u00b7 AI adjudication \u2713" : ""}`);
  L.push("");

  // Score gauge
  const scoreColor = r.score >= 90 ? C.green : r.score >= 60 ? C.yellow : C.red;
  L.push(`  ${C.bold}Compliance score:${C.reset} ${scoreColor}${r.score}/100${C.reset}`);
  L.push("");

  // Licenses found
  if (r.projectLicenses.size) {
    L.push(`${C.bold}Project licenses${C.reset}`);
    for (const [id, info] of r.projectLicenses) {
      L.push(`  \u2022 ${C.bold}${id}${C.reset} ${C.gray}(${categoryLabel(info.category)})${C.reset} ${info.file ? C.gray + info.file + C.reset : ""}`);
    }
    L.push("");
  }

  if (r.thirdParty.size) {
    L.push(`${C.bold}Third-party licenses${C.reset}`);
    for (const [id, info] of [...r.thirdParty.entries()].sort()) {
      L.push(`  \u2022 ${id} ${C.gray}(${categoryLabel(info.category)}, ${info.files.length} file${info.files.length === 1 ? "" : "s"})${C.reset}`);
    }
    L.push("");
  }

  if (r.dependencies.length) {
    const byEco = new Map<string, number>();
    for (const d of r.dependencies) byEco.set(d.ecosystem, (byEco.get(d.ecosystem) ?? 0) + 1);
    L.push(`${C.bold}Dependencies${C.reset}`);
    for (const [eco, n] of [...byEco.entries()].sort()) {
      L.push(`  \u2022 ${eco}: ${n}`);
    }
    L.push("");
  }

  if (r.findings.length) {
    L.push(`${C.bold}Findings${C.reset} (${r.findings.length})`);
    const sorted = [...r.findings].sort((a, b) => severityRank(a.severity) - severityRank(b.severity));
    for (const f of sorted) {
      L.push(`  ${SEV_COLOR[f.severity]}${SEV_ICON[f.severity]} [${f.severity.toUpperCase()}]${C.reset} ${C.bold}${f.title}${C.reset}`);
      L.push(`    ${C.dim}${f.rule}${f.file ? ` \u00b7 ${f.file}` : ""}${C.reset}`);
      L.push(`    ${f.detail}`);
      L.push(`    ${C.green}\u2192 ${f.remediation}${C.reset}`);
      L.push("");
    }
  } else {
    L.push(`${C.green}${C.bold}\u2713 No license violations detected.${C.reset}`);
    L.push("");
  }

  return L.join("\n");
}

export function toJson(r: ScanReport): string {
  return JSON.stringify(
    {
      tool: "secular",
      version: "1.0.0",
      root: r.root,
      filesScanned: r.filesScanned,
      score: r.score,
      spdxVersion: r.catalogVersion,
      aiAdjudication: r.usedAi,
      projectLicenses: Object.fromEntries(r.projectLicenses),
      thirdPartyLicenses: Object.fromEntries(
        [...r.thirdParty.entries()].map(([id, v]) => [id, { category: v.category, files: v.files }])
      ),
      dependencyCount: r.dependencies.length,
      findings: r.findings,
    },
    null,
    2
  );
}

export function toMarkdown(r: ScanReport): string {
  const L: string[] = [];
  L.push("# Secular License Compliance Report");
  L.push("");
  L.push(`- **Root:** \`${r.root}\``);
  L.push(`- **Files scanned:** ${r.filesScanned}`);
  L.push(`- **Compliance score:** ${r.score}/100`);
  L.push(`- **SPDX catalog:** v${r.catalogVersion}`);
  L.push(`- **AI adjudication:** ${r.usedAi ? "yes" : "no"}`);
  L.push("");
  if (r.projectLicenses.size) {
    L.push("## Project licenses");
    L.push("");
    L.push("| License | Category | File |");
    L.push("|---|---|---|");
    for (const [id, info] of r.projectLicenses) {
      L.push(`| ${id} | ${categoryLabel(info.category)} | ${info.file ?? "\u2014"} |`);
    }
    L.push("");
  }
  if (r.thirdParty.size) {
    L.push("## Third-party licenses");
    L.push("");
    L.push("| License | Category | Files |");
    L.push("|---|---|---|");
    for (const [id, info] of [...r.thirdParty.entries()].sort()) {
      L.push(`| ${id} | ${categoryLabel(info.category)} | ${info.files.length} |`);
    }
    L.push("");
  }
  if (r.findings.length) {
    L.push("## Findings");
    L.push("");
    for (const f of r.findings) {
      L.push(`### [${f.severity.toUpperCase()}] ${f.title}`);
      L.push("");
      L.push(`- **Rule:** \`${f.rule}\``);
      if (f.license) L.push(`- **License:** ${f.license}`);
      if (f.file) L.push(`- **File:** \`${f.file}\``);
      L.push(`- **Detail:** ${f.detail}`);
      L.push(`- **Remediation:** ${f.remediation}`);
      L.push("");
    }
  } else {
    L.push("## Findings");
    L.push("");
    L.push("\u2713 No license violations detected.");
    L.push("");
  }
  return L.join("\n");
}

export function toSarif(r: ScanReport): string {
  const rules = [...new Set(r.findings.map((f) => f.rule))].map((id) => ({
    id,
    shortDescription: { text: id },
    fullDescription: { text: id },
    defaultConfiguration: { level: "error" },
  }));

  const severityMap: Record<Severity, string> = {
    critical: "error",
    error: "error",
    warning: "warning",
    info: "note",
  };

  return JSON.stringify(
    {
      $schema: "https://json.schemastore.org/sarif-2.1.0.json",
      version: "2.1.0",
      runs: [
        {
          tool: {
            driver: {
              name: "secular",
              version: "1.0.0",
              informationUri: "https://github.com/HahaAhhDev/secular",
              rules,
            },
          },
          results: r.findings.map((f: Finding) => ({
            ruleId: f.rule,
            level: severityMap[f.severity],
            message: { text: `${f.title}. ${f.detail} Remediation: ${f.remediation}` },
            locations: f.file
              ? [
                  {
                    physicalLocation: {
                      artifactLocation: { uri: f.file },
                    },
                  },
                ]
              : [],
          })),
        },
      ],
    },
    null,
    2
  );
}

/** Generate THIRD-PARTY-NOTICES.md from the report. */
export function toNotices(r: ScanReport): string {
  const L: string[] = [];
  L.push("THIRD-PARTY SOFTWARE NOTICES");
  L.push("============================");
  L.push("");
  L.push("This product includes software developed by third parties.");
  L.push("");
  for (const [id, info] of [...r.thirdParty.entries()].sort()) {
    L.push(`--- ${id} ---`);
    for (const f of info.files) L.push(`  Source: ${f}`);
    L.push(`  License: ${id}`);
    L.push("");
  }
  if (r.thirdParty.size === 0) {
    L.push("(No third-party license files detected.)");
    L.push("");
  }
  return L.join("\n");
}
