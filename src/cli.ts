#!/usr/bin/env node
/**
 * secular — license compliance scanning with optional AI adjudication.
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
import { evaluate, complianceScore, severityRank, type Severity } from "./rules.js";
import { adjudicate, resolveAiConfig, type Adjudication } from "./ai.js";
import { getMeta } from "./meta.js";
import { terminal, toJson, toMarkdown, toSarif, toNotices } from "./report.js";
import { loadCatalog } from "./spdx.js";
import { fileURLToPath } from "node:url";

const VERSION = (() => {
  try {
    return JSON.parse(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "package.json"), "utf8")).version as string;
  } catch {
    return "1.0.0";
  }
})();

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
  failOnRule?: string[];
  exclude?: string[];
  refresh?: boolean;
  strict?: boolean;
  noColor?: boolean;
  includeLicenseFiles?: boolean;
  skipMode?: "auto" | "ask" | "scan";
  yes?: boolean;
}

const SEV_ORDER = ["info", "warning", "error", "critical"];

/** Rules the rules engine can emit, for --fail-on-rule validation. */
const KNOWN_RULES = new Set([
  "COPYLEFT-IN-PROPRIETARY", "NETWORK-COPYLEFT", "NON-OPEN-LICENSE",
  "PROJECT-LICENSE-CONFLICT", "PROJECT-LICENSE-UNFREE", "WEAK-COPYLEFT",
  "UNKNOWN-LICENSE", "MISSING-NOTICE",
]);

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
      case "--fail-on-rule": {
        const rule = shiftValue(a).toUpperCase();
        if (!KNOWN_RULES.has(rule)) {
          console.error(`error: --fail-on-rule must be one of: ${[...KNOWN_RULES].join(", ")}`);
          process.exit(2);
        }
        (args.failOnRule ??= []).push(rule);
        break;
      }
      case "--exclude": {
        const dir = shiftValue(a);
        if (!dir.trim()) {
          console.error("error: --exclude requires a directory name");
          process.exit(2);
        }
        (args.exclude ??= []).push(dir);
        break;
      }
      case "--json-include-license-files":
        args.includeLicenseFiles = true;
        break;
      case "--skip-mode": {
        const m = shiftValue(a);
        if (m !== "auto" && m !== "ask" && m !== "scan") {
          console.error("error: --skip-mode must be one of: auto, ask, scan");
          process.exit(2);
        }
        args.skipMode = m;
        break;
      }
      case "--scan-all":
        args.skipMode = "scan";
        break;
      case "-y":
      case "--yes":
        args.yes = true;
        break;
      case "--no-color":
        args.noColor = true;
        break;
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
        console.log(`secular ${VERSION}`);
        process.exit(0);
      default:
        if (!a.startsWith("-")) {
          if (!fs.existsSync(a)) {
            console.error(`error: directory not found: ${a}`);
            process.exit(2);
          }
          args.dir = a;
        } else {
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
${"\u001b[1m"}secular${"\u001b[0m"} — license compliance scanning (v${VERSION})

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
      --fail-on-rule <r>  Exit 1 if a finding matches this rule (repeatable)
      --exclude <dir>     Skip a directory by name (repeatable)
      --skip-mode <mode>  Auto-detected skip handling: auto (default, skip
                          silently) | ask (prompt per detection) | scan (scan
                          detected dirs too). SECULAR_SKIP_MODE env also works.
      --scan-all          Shorthand for --skip-mode scan
      -y, --yes           In ask mode, auto-answer "ignore" (non-interactive)
      --no-color          Disable colored terminal output
      --json-include-license-files  Include per-file license matches in JSON
      --refresh           Force SPDX catalog refresh
  -h, --help              Show help
  -v, --version           Show version

${"\u001b[1m"}EXAMPLES${"\u001b[0m"}
  secular scan .                          # basic scan, terminal report
  secular ai . --api-key sk-...           # scan + AI adjudication
  secular scan . -f sarif -o secular.sarif
  secular scan . --strict && npm test     # CI gate
  secular scan . --fail-on-rule NETWORK-COPYLEFT
  secular scan . --exclude test --exclude fixtures
`);
}

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

/** True when running in a terminal and colors were not disabled. */
function useColor(noColor?: boolean): boolean {
  if (noColor) return false;
  if (process.env.FORCE_COLOR && process.env.FORCE_COLOR !== "0") return true;
  if (process.env.NO_COLOR) return false;
  return Boolean(process.stdout.isTTY);
}

/**
 * Skip-permission handler for "ask" mode. Prints the auto-detected skip
 * candidates and asks once: ignore (skip them — safe default) or continue
 * (scan them). Falls back to "ignore" when not interactive or when -y given.
 */
function makeSkipDecision(): (skipped: { rel: string; reason: string }[]) => "ignore" | "scan" {
  const decision = (function ask(this: { _firstByte?: string }, skipped: { rel: string; reason: string }[]): "ignore" | "scan" {
    console.error(`\nsecular detected ${skipped.length} director${skipped.length === 1 ? "y" : "ies"} it would normally skip:`);
    for (const s of skipped.slice(0, 10)) {
      console.error(`  · ${s.rel}  (${s.reason})`);
    }
    if (skipped.length > 10) console.error(`  · … and ${skipped.length - 10} more`);
    if (args.yes) {
      console.error("  → ignoring (-y given)");
      return "ignore";
    }
    if (!process.stdin.isTTY) {
      // Piped input can still carry an answer (e.g. `printf 's\n' | secular ...`).
      // Only EOF (empty stdin) means non-interactive.
      try {
        const probe = Buffer.alloc(1);
        if (fs.readSync(0, probe, 0, 1, null) === 0) {
          console.error("  → ignoring (non-interactive; use --scan-all to scan them)");
          return "ignore";
        }
        // Push the byte back by remembering it — read the rest of the line manually below.
        (decision as { _firstByte?: string })._firstByte = probe.toString();
      } catch {
        console.error("  → ignoring (non-interactive; use --scan-all to scan them)");
        return "ignore";
      }
    }
    console.error("  Scan these directories anyway? [i]gnore / [s]can (default: ignore)");
    process.stderr.write("> ");
    // Synchronous single-byte read: works on TTYs and pipes alike.
    const buf = Buffer.alloc(1);
    let byte: string | null;
    const first = decision._firstByte;
    if (first !== undefined) {
      byte = first.toLowerCase();
      delete decision._firstByte;
    } else {
      try {
        byte = fs.readSync(0, buf, 0, 1, null) === 0 ? null : buf.toString().trim().toLowerCase();
      } catch {
        byte = null;
      }
    }
    if (byte === "s") {
      console.error("  → scanning detected directories");
      return "scan";
    }
    console.error("  → ignoring");
    return "ignore";
  } as ((this: { _firstByte?: string }, skipped: { rel: string; reason: string }[]) => "ignore" | "scan") & { _firstByte?: string });
  return decision;
}
let args: Args; // populated by main; used by makeSkipDecision for -y

async function main(): Promise<number> {
  args = parseArgs(process.argv.slice(2));
  const skipMode = args.skipMode ?? ((process.env.SECULAR_SKIP_MODE as Args["skipMode"]) || "auto");
  const skipOpts = {
    skipMode: skipMode as "auto" | "ask" | "scan",
    onSkipDecision: skipMode === "ask" ? makeSkipDecision() : undefined,
  };

  if (args.command === "cache") {
    // With --refresh: always refetch. Without: only fetch if no fresh cache
    // (loadCatalog's TTL handles it) — a bare `secular cache` must not hit
    // the network when the cache is current.
    const cat = await loadCatalog({ refresh: args.refresh === true });
    console.log(`SPDX catalog v${cat.licenseListVersion} — ${cat.licenses.length} licenses cached.`);
    return 0;
  }

  // Validate the target directory up front for all scanning commands.
  if (!fs.existsSync(args.dir) || !fs.statSync(args.dir).isDirectory()) {
    console.error(`error: not a directory: ${args.dir}`);
    return 2;
  }

  if (args.command === "notice") {
    const report = await scan({ root: args.dir, refreshCatalog: args.refresh, exclude: args.exclude, ...skipOpts });
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

  const report = await scan({ root: args.dir, refreshCatalog: args.refresh, exclude: args.exclude, ...skipOpts });
  report.usedAi = useAi;

  // AI adjudication of unknown / low-confidence licenses. Applies when the
  // fingerprinter found nothing, matched below 90%, or the matched id has no
  // known category (custom/non-SPDX licenses) — the AI still classifies them.
  if (aiCfg) {
    const ambiguous = report.licenseFiles.filter(
      (h) => !h.id || h.score === undefined || h.score < 0.9 || getMeta(h.id).category === "unknown"
    );
    for (const hit of ambiguous.slice(0, 20)) {
      try {
        const adj: Adjudication = await adjudicate(aiCfg, hit.excerpt, hit.id ? `fingerprint matched ${hit.id} at ${(hit.score! * 100).toFixed(0)}%` : undefined);
        if (adj.category !== "unknown" && adj.confidence >= 0.5) {
          hit.id = adj.license;
          hit.score = adj.confidence;
          if (!report.projectLicenses.has(adj.license) && !report.thirdParty.has(adj.license)) {
            const isRoot = report.projectLicenses.size === 0 && /^(?:UN)?LICEN[CS]E|^COPYING|^NOTICE$|^COPYRIGHT$/i.test(path.basename(hit.file));
            if (isRoot) {
              if (!report.projectLicenses.has(adj.license)) {
                report.projectLicenses.set(adj.license, { category: adj.category as never, file: hit.file });
              }
            } else if (!report.thirdParty.has(adj.license)) {
              report.thirdParty.set(adj.license, { category: adj.category as never, files: [hit.file] });
            }
          }
        }
        console.error(`\u2713 AI adjudicated ${hit.file}: ${adj.license} (${adj.category}, confidence ${(adj.confidence * 100).toFixed(0)}%)`);
      } catch (err) {
        console.error(`warning: AI adjudication failed for ${hit.file}: ${(err as Error).message}`);
      }
    }
  }

  // Re-evaluate rules with the AI-augmented license sets (no re-walk needed).
  if (aiCfg) {
    const ctx = buildContext({
      projectLicenses: report.projectLicenses,
      thirdParty: report.thirdParty,
      proprietary: ![...report.projectLicenses.values()].some(
        (i) => i.category === "strong-copyleft" || i.category === "weak-copyleft"
      ),
      root: report.root,
    });
    ctx.hasNoticeFile = report.licenseFiles.some((h) => /^(NOTICE|THIRD[-_ ]?PARTY|LEGAL)/i.test(path.basename(h.file)));
    report.findings = evaluate(ctx);
    report.score = complianceScore(report.findings);
  }

  // Severity filter (affects both report and exit-code decisions).
  if (args.minSeverity) {
    const min = SEV_ORDER.indexOf(args.minSeverity);
    if (min >= 0) report.findings = report.findings.filter((f) => SEV_ORDER.indexOf(f.severity) >= min);
  }

  let out: string;
  (globalThis as { __SECULAR_VERSION__?: string }).__SECULAR_VERSION__ = VERSION;
  switch (args.format) {
    case "json": out = toJson(report, { includeLicenseFiles: args.includeLicenseFiles }); break;
    case "markdown": out = toMarkdown(report); break;
    case "sarif": out = toSarif(report); break;
    default: out = terminal(report, { color: useColor(args.noColor) });
  }

  if (args.output) {
    writeOutput(out, args.output);
  } else {
    console.log(out);
  }

  // ---- Exit-code logic ----
  // 1) --strict: any finding at/above threshold fails (minSeverity already
  //    applied to report.findings).
  if (args.strict && report.findings.length > 0) return 1;
  // 2) --fail-on-rule: named rules fail regardless of severity.
  if (args.failOnRule?.length && report.findings.some((f) => args.failOnRule!.includes(f.rule))) return 1;
  // 3) Default: any critical finding fails.
  if (report.findings.some((f) => f.severity === "critical")) return 1;
  return 0;
}

// ---- Global error handling ------------------------------------------------
// Anything that escapes the command handlers lands here: a clean message on
// stderr, an exit code of 2, and no stack-trace spew unless SECULAR_DEBUG is
// set. Unhandled rejections from async paths are caught the same way.

function fail(err: unknown, label: string): never {
  const msg = err instanceof Error ? err.message : String(err);
  if (process.env.SECULAR_DEBUG) {
    console.error(`secular: [${label}]`, err);
  } else {
    console.error(`secular: ${msg}`);
  }
  process.exit(2);
}

process.on("unhandledRejection", (reason) => fail(reason, "unhandled rejection"));
process.on("uncaughtException", (err) => fail(err, "uncaught exception"));

// A broken output pipe (e.g. `secular scan . | head`) must not spew a JS
// stack trace; exit quietly like well-behaved CLI tools do.
process.stdout?.on?.("error", (err: NodeJS.ErrnoException) => {
  if (err.code === "EPIPE") process.exit(0);
  throw err;
});

main().then(
  (code) => process.exit(code),
  (err) => fail(err, "fatal")
);
