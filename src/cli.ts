#!/usr/bin/env node
/**
 * secular — elite AI-powered license compliance scanning.
 *
 *   secular scan [dir]            Scan a codebase
 *   secular notice [dir]          Generate THIRD-PARTY-NOTICES.md
 *   secular ai [dir]              Scan + AI-adjudicate ambiguous findings
 *   secular cache --refresh       Refresh the SPDX catalog cache
 *   secular --version | --help
 */

import fs from "node:fs";
import path from "node:path";
import { scan, buildContext } from "./scan.js";
import { evaluate, complianceScore } from "./rules.js";
import { adjudicate, resolveAiConfig, type Adjudication } from "./ai.js";
import { terminal, toJson, toMarkdown, toSarif, toNotices } from "./report.js";
import { loadCatalog } from "./spdx.js";

interface Args {
  command: string;
  dir: string;
  format: "terminal" | "json" | "markdown" | "sarif";
  apiKey?: string;
  provider?: string;
  model?: string;
  baseUrl?: string;
  output?: string;
  minSeverity?: string;
  refresh?: boolean;
  strict?: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    command: "scan",
    dir: ".",
    format: "terminal",
  };
  const VALID_FORMATS = new Set(["terminal", "json", "markdown", "sarif"]);
  const rest = argv.slice();
  const isFlag = (s: string | undefined) => s !== undefined && s.startsWith("-") && s !== "-";
  const shiftValue = (flag: string): string => {
    const v = rest.shift();
    if (v === undefined || isFlag(v)) {
      console.error(`error: ${flag} requires a value`);
      process.exit(2);
    }
    return v;
  };
  while (rest.length) {
    const a = rest.shift()!;
    switch (a) {
      case "scan":
      case "notice":
      case "ai":
      case "cache":
        args.command = a;
        break;
      case "--format":
      case "-f": {
        const fmt = shiftValue(a);
        if (!VALID_FORMATS.has(fmt)) {
          console.error(`error: --format must be one of: ${[...VALID_FORMATS].join(", ")}`);
          process.exit(2);
        }
        args.format = fmt as Args["format"];
        break;
      }
      case "--api-key":
      case "-k":
        args.apiKey = shiftValue(a);
        break;
      case "--provider":
        args.provider = shiftValue(a);
        break;
      case "--model":
        args.model = shiftValue(a);
        break;
      case "--base-url":
        args.baseUrl = shiftValue(a);
        break;
      case "--output":
      case "-o":
        args.output = shiftValue(a);
        break;
      case "--min-severity": {
        const sev = shiftValue(a);
        if (!SEV_ORDER.includes(sev)) {
          console.error(`error: --min-severity must be one of: ${SEV_ORDER.join(", ")}`);
          process.exit(2);
        }
        args.minSeverity = sev;
        break;
      }
      case "--refresh":
        args.refresh = true;
        break;
      case "--strict":
        args.strict = true;
        break;
      case "--help":
      case "-h":
        printHelp();
        process.exit(0);
      case "--version":
      case "-v":
        console.log("secular 1.0.0");
        process.exit(0);
      default:
        if (!a.startsWith("--") && !a.startsWith("-")) {
          if (!fs.existsSync(a)) {
            console.error(`error: directory not found: ${a}`);
            process.exit(2);
          }
          args.dir = a;
        } else if (a.startsWith("-")) {
          console.error(`error: unknown option: ${a} (see --help)`);
          process.exit(2);
        }
        break;
    }
  }
  return args;
}

function printHelp(): void {
  console.log(`
${"\u001b[1m"}secular${"\u001b[0m"} — elite AI-powered license compliance scanning

${"\u001b[1m"}USAGE${"\u001b[0m"}
  secular <command> [dir] [options]

${"\u001b[1m"}COMMANDS${"\u001b[0m"}
  scan [dir]              Scan a codebase for license violations (default)
  notice [dir]            Generate THIRD-PARTY-NOTICES.md
  ai [dir]                Scan + AI-adjudicate ambiguous licenses (needs API key)
  cache --refresh         Refresh the SPDX license catalog cache

${"\u001b[1m"}OPTIONS${"\u001b[0m"}
  -k, --api-key <key>     LLM API key (or SECULAR_API_KEY / OPENAI_API_KEY env)
      --provider <name>   openai | anthropic | openrouter | ollama
      --model <model>     Model id (provider default if omitted)
      --base-url <url>    Custom OpenAI-compatible endpoint
  -f, --format <fmt>      terminal | json | markdown | sarif
  -o, --output <file>     Write report to a file
      --min-severity <s>  Filter: info | warning | error | critical
      --strict            Exit non-zero on any finding (CI mode)
      --refresh           Force SPDX catalog refresh
  -h, --help              Show help
  -v, --version           Show version

${"\u001b[1m"}EXAMPLES${"\u001b[0m"}
  secular scan .                          # basic scan, terminal report
  secular ai . --api-key sk-...           # scan + AI adjudication
  secular scan . -f sarif -o secular.sarif
  secular scan . --strict && npm test     # CI gate
`);
}

const SEV_ORDER = ["info", "warning", "error", "critical"];

/** Write output to a file with a friendly error if the path is unwritable. */
function writeOutput(out: string, file: string): void {
  try {
    fs.writeFileSync(file, out + (out.endsWith("\n") ? "" : "\n"));
    console.error(`\u2713 Report written to ${file}`);
  } catch (err) {
    console.error(`error: cannot write to ${file}: ${(err as NodeJS.ErrnoException).code ?? (err as Error).message}`);
    process.exit(2);
  }
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));

  if (args.command === "cache") {
    const cat = await loadCatalog({ refresh: true });
    console.log(`SPDX catalog v${cat.licenseListVersion} — ${cat.licenses.length} licenses cached.`);
    return 0;
  }

  // Validate the target directory up front for all scanning commands.
  if (!fs.existsSync(args.dir) || !fs.statSync(args.dir).isDirectory()) {
    console.error(`error: not a directory: ${args.dir}`);
    return 2;
  }

  if (args.command === "notice") {
    const report = await scan({ root: args.dir, refreshCatalog: args.refresh });
    const notices = toNotices(report);
    const out = args.output ?? "THIRD-PARTY-NOTICES.md";
    writeOutput(notices, out);
    return 0;
  }

  const useAi = args.command === "ai";
  let aiCfg = null;
  if (useAi) {
    aiCfg = resolveAiConfig({
      apiKey: args.apiKey,
      provider: args.provider,
      model: args.model,
      baseUrl: args.baseUrl,
    });
    if (!aiCfg) {
      console.error("error: --api-key (or SECULAR_API_KEY / OPENAI_API_KEY) is required for `secular ai`");
      return 2;
    }
  }

  const report = await scan({ root: args.dir, refreshCatalog: args.refresh });
  report.usedAi = useAi;

  // AI adjudication of unknown / low-confidence licenses.
  if (aiCfg) {
    const ambiguous = report.licenseFiles.filter((h) => !h.id || h.score === undefined || h.score < 0.9);
    for (const hit of ambiguous.slice(0, 20)) {
      try {
        const adj: Adjudication = await adjudicate(aiCfg, hit.excerpt, hit.id ? `fingerprint matched ${hit.id} at ${(hit.score! * 100).toFixed(0)}%` : undefined);
        if (adj.category !== "unknown" && adj.confidence >= 0.5) {
          hit.id = adj.license;
          hit.score = adj.confidence;
          if (!report.projectLicenses.has(adj.license) && !report.thirdParty.has(adj.license)) {
            report.thirdParty.set(adj.license, { category: adj.category as never, files: [hit.file] });
          }
        }
        console.error(`\u2713 AI adjudicated ${hit.file}: ${adj.license} (${adj.category}, confidence ${(adj.confidence * 100).toFixed(0)}%)`);
      } catch (err) {
        console.error(`warning: AI adjudication failed for ${hit.file}: ${(err as Error).message}`);
      }
    }
  }

  // Re-evaluate rules with the AI-augmented third-party set (no re-walk needed).
  if (aiCfg) {
    const ctx = buildContext({
      projectLicenses: report.projectLicenses,
      thirdParty: report.thirdParty,
      proprietary: ![...report.projectLicenses.values()].some(
        (i) => i.category === "strong-copyleft" || i.category === "weak-copyleft"
      ),
      root: report.root,
    });
    report.findings = evaluate(ctx);
    report.score = complianceScore(report.findings);
  }

  // Severity filter.
  if (args.minSeverity) {
    const min = SEV_ORDER.indexOf(args.minSeverity);
    if (min >= 0) report.findings = report.findings.filter((f) => SEV_ORDER.indexOf(f.severity) >= min);
  }

  let out: string;
  switch (args.format) {
    case "json": out = toJson(report); break;
    case "markdown": out = toMarkdown(report); break;
    case "sarif": out = toSarif(report); break;
    default: out = terminal(report);
  }

  if (args.output) {
    writeOutput(out, args.output);
  } else {
    console.log(out);
  }

  if (args.strict && report.findings.length > 0) return 1;
  const hasCritical = report.findings.some((f) => f.severity === "critical");
  return hasCritical ? 1 : 0;
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error(`secular: ${(err as Error).message}`);
    process.exit(2);
  }
);
