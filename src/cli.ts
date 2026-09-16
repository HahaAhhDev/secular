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
import { evaluate, complianceScore, severityRank, type Finding, type Severity } from "./rules.js";
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
  failOnCategory?: string[];
  failOnScore?: number;
  failOnUnknown?: boolean;
  allowLicense?: string[];
  denyLicense?: string[];
  minScore?: number;
  maxFiles?: number;
  exclude?: string[];
  excludeFile?: string[];
  config?: string;
  quiet?: boolean;
  summary?: boolean;
  listRules?: boolean;
  depAudit?: boolean;
  ci?: boolean;
  noticeFormat?: "markdown" | "text";
  appendNotice?: boolean;
  timeout?: number;
  noVendorScan?: boolean;
  includeHidden?: boolean;
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
  "UNKNOWN-LICENSE", "MISSING-NOTICE", "DENIED-LICENSE",
]);

const VALID_CATEGORIES = new Set([
  "public-domain", "permissive", "weak-copyleft", "strong-copyleft", "network-copyleft", "unfree", "unknown",
]);

const RULE_INFO: Record<string, string> = {
  "COPYLEFT-IN-PROPRIETARY": "critical — Strong copyleft (GPL) license in a proprietary codebase",
  "NETWORK-COPYLEFT": "critical — AGPL/EUPL/OSL-style network copyleft license",
  "NON-OPEN-LICENSE": "critical — SSPL, CC-BY-NC* and other non-open licenses",
  "PROJECT-LICENSE-CONFLICT": "error — Root LICENSE is copyleft but project appears proprietary",
  "PROJECT-LICENSE-UNFREE": "error — Root LICENSE restricts use",
  "WEAK-COPYLEFT": "warning — MPL, EPL, CDDL, LGPL — disclose modifications",
  "UNKNOWN-LICENSE": "warning — Unidentifiable license text",
  "MISSING-NOTICE": "info — Attribution licenses present but no NOTICE/THIRD-PARTY file",
};

function parseArgs(argv: string[], configDefaults: Partial<Args> = {}): Args | "handled" {
  const args: Args = {
    command: "scan",
    dir: ".",
    format: "terminal",
    ...configDefaults,
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
  // Track which option keys the CLI explicitly set, so repeatable-array
  // flags (--exclude, --exclude-file, --allow-license, --deny-license,
  // --fail-on-rule, --fail-on-category) REPLACE their config defaults
  // instead of appending to them.
  const cliSet = new Set<keyof Args>();
  const setArr = <K extends "exclude" | "excludeFile" | "allowLicense" | "denyLicense" | "failOnRule" | "failOnCategory">(key: K, value: string) => {
    if (!cliSet.has(key)) {
      args[key] = [];
      cliSet.add(key);
    }
    (args[key] as string[]).push(value);
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
        setArr("failOnRule", rule);
        break;
      }
      case "--exclude": {
        const dir = shiftValue(a);
        if (!dir.trim()) {
          console.error("error: --exclude requires a directory name");
          process.exit(2);
        }
        setArr("exclude", dir);
        break;
      }
      case "--json-include-license-files":
        args.includeLicenseFiles = true;
        break;
      case "--fail-on-category": {
        const cat = shiftValue(a).toLowerCase();
        if (!VALID_CATEGORIES.has(cat)) {
          console.error(`error: --fail-on-category must be one of: ${[...VALID_CATEGORIES].join(", ")}`);
          process.exit(2);
        }
        setArr("failOnCategory", cat);
        break;
      }
      case "--fail-on-score": {
        const n = Number(shiftValue(a));
        if (!Number.isFinite(n) || n < 0 || n > 100) {
          console.error("error: --fail-on-score requires a number 0-100");
          process.exit(2);
        }
        args.failOnScore = n;
        break;
      }
      case "--fail-on-unknown":
        args.failOnUnknown = true;
        break;
      case "--allow-license":
        setArr("allowLicense", shiftValue(a));
        break;
      case "--deny-license":
        setArr("denyLicense", shiftValue(a));
        break;
      case "--min-score": {
        const n = Number(shiftValue(a));
        if (!Number.isFinite(n) || n <= 0 || n > 1) {
          console.error("error: --min-score requires a number between 0 and 1 (e.g. 0.85)");
          process.exit(2);
        }
        args.minScore = n;
        break;
      }
      case "--max-files": {
        const n = Number(shiftValue(a));
        if (!Number.isInteger(n) || n < 1) {
          console.error("error: --max-files requires a positive integer");
          process.exit(2);
        }
        args.maxFiles = n;
        break;
      }
      case "--timeout": {
        const n = Number(shiftValue(a));
        if (!Number.isFinite(n) || n <= 0) {
          console.error("error: --timeout requires a positive number of seconds");
          process.exit(2);
        }
        args.timeout = n;
        break;
      }
      case "--exclude-file":
        setArr("excludeFile", shiftValue(a));
        break;
      case "--no-vendor-scan":
        args.noVendorScan = true;
        break;
      case "--include-hidden":
        args.includeHidden = true;
        break;
      case "--license-info": {
        const id = shiftValue(a);
        // Async internally; the .then chain calls process.exit when done.
        printLicenseInfo(id);
        return "handled"; // never falls through to main's scan flow
      }
      case "--spdx-info": {
        const id = shiftValue(a);
        import("./spdx.js").then(async ({ lookupLicense }) => {
          const lic = await lookupLicense(id);
          if (!lic) {
            console.error(`error: "${id}" not found in the SPDX catalog`);
            process.exit(2);
          }
          console.log(`${lic.licenseId}${lic.isDeprecatedLicenseId ? " (DEPRECATED)" : ""}${lic.isOsiApproved ? " [OSI-approved]" : ""}`);
          console.log(`  name: ${lic.name}`);
          if (lic.seeAlso?.length) console.log(`  see also: ${lic.seeAlso.join(", ")}`);
          if (lic.licenseText) console.log(`  text: ${lic.licenseText.length} characters (cached)`);
        }).then(() => process.exit(0), (err) => fail(err, "spdx-info"));
        return "handled"; // async — handled above; process exits there
      }
      // (spdx-info continues from the shared async pattern above)
      case "--init":
        writeConfigScaffold();
        process.exit(0);
      case "--init-ci":
        writeCiScaffold();
        process.exit(0);
      case "--config":
        args.config = shiftValue(a);
        break;
      case "--quiet":
      case "-q":
        args.quiet = true;
        break;
      case "--summary":
        args.summary = true;
        break;
      case "--list-rules":
        args.listRules = true;
        break;
      case "--dep-audit":
        args.depAudit = true;
        break;
      case "--ci":
        args.ci = true;
        args.strict = true;
        args.quiet = true;
        args.format = "sarif";
        break;
      case "--notice-format": {
        const f = shiftValue(a);
        if (f !== "markdown" && f !== "text") {
          console.error("error: --notice-format must be markdown or text");
          process.exit(2);
        }
        args.noticeFormat = f;
        break;
      }
      case "--append-notice":
        args.appendNotice = true;
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

/** Print category/obligations metadata for one SPDX id (--license-info). */
function printLicenseInfo(id: string): void {
  // Import lazily to keep startup fast for other commands.
  import("./meta.js").then(({ getMeta, categoryLabel }) => {
    const m = getMeta(id);
    console.log(`${m.id}`);
    console.log(`  category:    ${categoryLabel(m.category)} (${m.category})`);
    console.log(`  obligations: ${m.obligations}`);
    if (m.notable) console.log(`  notable:     ${m.notable}`);
    if (m.category === "unknown") {
      console.log("\nThis id is not in secular's built-in metadata.");
      console.log("The SPDX catalog may still contain the full text — try scanning a file containing it.");
    }
    process.exit(0);
  }).catch((err) => fail(err, "license-info"));
}

/** Write a commented .secularrc.json scaffold (--init). */
function writeConfigScaffold(): void {
  const file = ".secularrc.json";
  if (fs.existsSync(file)) {
    console.error(`error: ${file} already exists`);
    process.exit(2);
  }
  const scaffold = {
    failOnRule: [],
    failOnCategory: [],
    allowLicense: [],
    denyLicense: [],
    strict: false,
    format: "terminal",
  };
  fs.writeFileSync(file, JSON.stringify(scaffold, null, 2) + "\n");
  console.error(`\u2713 Created ${file} — edit it, values apply to every scan in this directory tree.`);
}

/** Write a GitHub Actions workflow scaffold (--init-ci). */
function writeCiScaffold(): void {
  const dir = ".github/workflows";
  const file = `${dir}/secular.yml`;
  if (fs.existsSync(file)) {
    console.error(`error: ${file} already exists`);
    process.exit(2);
  }
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file, `# Auto-generated by secular --init-ci
name: license-compliance
on: [push, pull_request]

jobs:
  secular:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - name: Install secular
        run: |
          github_token=\${{ secrets.GITHUB_TOKEN }}
          npm config set @hahaahhdev:registry https://npm.pkg.github.com
          npm config set //npm.pkg.github.com/:_authToken "\$github_token"
          npm install -g @hahaahhdev/secular
      - name: Scan
        run: secular scan . --ci --strict -o license.sarif
      - uses: github/codeql-action/upload-sarif@v3
        if: always()
        with:
          sarif_file: license.sarif
`);
  console.error(`\u2713 Created ${file} — commit it to enable license scanning in GitHub Actions.`);
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
      --license-info <id>     Print secular's classification metadata for an SPDX id
      --spdx-info <id>        Print SPDX catalog entry for an id (name, OSI, deprecated)
      --init                  Create a .secularrc.json config scaffold in the current dir
      --init-ci               Create a GitHub Actions workflow for license scanning
  -v, --version           Show version

${"\u001b[1m"}POLICY GATES${"\u001b[0m"}
      --fail-on-category <c>  Exit 1 if any license matches category (repeatable):
                          public-domain | permissive | weak-copyleft |
                          strong-copyleft | network-copyleft | unfree | unknown
      --fail-on-score <n>     Exit 1 if compliance score is below n (0-100)
      --fail-on-unknown       Exit 1 if any license text went unidentified
      --deny-license <id>     Exit 1 if this SPDX id is found (repeatable)
      --allow-license <id>    Suppress findings for this SPDX id (policy allowlist)
      --min-score <n>         Only trust matches at/above this confidence (0-1)

${"\u001b[1m"}PERFORMANCE & OUTPUT${"\u001b[0m"}
      --max-files <n>         Cap the number of files scanned
      --timeout <seconds>     Abort the scan if it runs longer than this
      --exclude-file <name>   Skip files by name/pattern (repeatable)
      --dep-audit             Cross-check manifest deps against disk licenses
      -q, --quiet             Suppress notes/warnings on stderr
      --summary               One-line summary instead of a full report
      --list-rules            Print all rules and exit
      --ci                    CI preset: --strict --quiet --format sarif

${"\u001b[1m"}EXAMPLES${"\u001b[0m"}
  secular scan .                          # basic scan, terminal report
  secular ai . --api-key sk-...           # scan + AI adjudication
  secular scan . -f sarif -o secular.sarif
  secular scan . --strict && npm test     # CI gate
  secular scan . --fail-on-rule NETWORK-COPYLEFT
  secular scan . --exclude test --exclude fixtures
  secular scan . --fail-on-category strong-copyleft
  secular scan . --deny-license SSPL-1.0 --allow-license MIT
  secular scan . --summary          # one line: score · files · findings
  secular scan . --ci               # SARIF, strict, quiet
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

/**
 * Load configuration values from a JSON config file (--config <path>,
 * $SECULAR_RC, or ./.secularrc.json). They serve as DEFAULTS: explicit CLI
 * flags are applied on top and win. Invalid values are warned about and
 * skipped; a broken file never fails the scan.
 */
function peekConfigPath(argv: string[]): string | undefined {
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--config") return argv[i + 1];
  }
  return undefined;
}

function loadConfigValues(configPath?: string): { values: Partial<Args>; file?: string | undefined } {
  const candidates = [configPath, process.env.SECULAR_RC, ".secularrc.json"];
  const isStrArr = (v: unknown) => Array.isArray(v) && v.every((x) => typeof x === "string");
  const isBool = (v: unknown) => typeof v === "boolean";
  const validators: Partial<Record<keyof Args, (v: unknown) => boolean>> = {
    exclude: isStrArr,
    excludeFile: isStrArr,
    failOnRule: isStrArr,
    failOnCategory: isStrArr,
    allowLicense: isStrArr,
    denyLicense: isStrArr,
    minSeverity: (v) => SEV_ORDER.includes(v as string),
    skipMode: (v) => v === "auto" || v === "ask" || v === "scan",
    format: (v) => ["terminal", "json", "markdown", "sarif"].includes(v as string),
    strict: isBool,
    quiet: isBool,
    summary: isBool,
    failOnUnknown: isBool,
    depAudit: isBool,
    noVendorScan: isBool,
    includeHidden: isBool,
    minScore: (v) => typeof v === "number" && v > 0 && v <= 1,
    failOnScore: (v) => typeof v === "number" && v >= 0 && v <= 100,
    maxFiles: (v) => typeof v === "number" && Number.isInteger(v) && v > 0,
    timeout: (v) => typeof v === "number" && v > 0,
  };
  for (const c of candidates) {
    if (!c) continue;
    try {
      if (!fs.existsSync(c)) continue;
      const raw = JSON.parse(fs.readFileSync(c, "utf8"));
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
        console.error(`warning: ${c} is not a JSON object — ignoring`);
        continue;
      }
      const values: Partial<Args> = {};
      let valid = true;
      for (const [key, validator] of Object.entries(validators) as [keyof Args, (v: unknown) => boolean][]) {
        const v = raw[key as string];
        if (v === undefined) continue;
        if (!validator(v)) {
          console.error(`warning: ${c}: invalid value for "${String(key)}" — ignoring`);
          valid = false;
          continue;
        }
        (values as Record<string, unknown>)[key as string] = v;
      }
      return { values, file: c };
    } catch (err) {
      console.error(`warning: could not read config ${c}: ${(err as Error).message}`);
    }
  }
  return { values: {} };
}

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  // Config values are defaults; parseArgs applies CLI flags on top so the
  // command line always wins.
  const cfg = loadConfigValues(peekConfigPath(argv));
  const parsed = parseArgs(argv, cfg.values);
  if (parsed === "handled") {
    // Async info commands (--license-info / --spdx-info) print and exit on
    // their own; keep the process alive until they do.
    await new Promise(() => {}); // never resolves — exited by the handler
  }
  args = parsed as Args;
  if (cfg.file && !args.quiet) {
    console.error(`note: using config from ${cfg.file}`);
  }

  if (args.listRules) {
    console.log("Rules evaluated by secular:\n");
    for (const [rule, info] of Object.entries(RULE_INFO)) {
      console.log(`  ${rule}\n    ${info}`);
    }
    console.log("\nUse with --fail-on-rule <rule> to gate CI on specific rules.");
    return 0;
  }

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
    const notices = toNotices(report, { format: args.noticeFormat ?? "markdown" });
    const ext = (args.noticeFormat ?? "markdown") === "text" ? ".txt" : ".md";
    const out = args.output ?? `THIRD-PARTY-NOTICES${ext}`;
    if (args.appendNotice && fs.existsSync(out)) {
      try {
        fs.appendFileSync(out, "\n" + notices);
        console.error(`\u2713 Appended notices to ${out}`);
        return 0;
      } catch (err) {
        console.error(`error: cannot append to ${out}: ${(err as NodeJS.ErrnoException).code ?? (err as Error).message}`);
        return 2;
      }
    }
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

  // Overall scan timeout (--timeout seconds): guards hung scans on pathological
  // filesystems (network mounts). A timer fires a clean error; scan continues
  // normally if it finishes first.
  if (args.timeout) {
    const t = setTimeout(() => {
      console.error(`error: scan timed out after ${args.timeout}s (use --timeout to increase)`);
      process.exit(2);
    }, args.timeout * 1000);
    t.unref();
  }

  const scanStart = Date.now();
  const report = await scan({
    root: args.dir,
    refreshCatalog: args.refresh,
    exclude: args.exclude,
    maxFiles: args.maxFiles,
    minScore: args.minScore,
    allowLicenses: args.allowLicense,
    denyLicenses: args.denyLicense,
    excludeFiles: args.excludeFile,
    depAudit: args.depAudit,
    noVendorScan: args.noVendorScan,
    includeHidden: args.includeHidden,
    ...skipOpts,
  });
  report.usedAi = useAi;
  report.scanDurationMs = Date.now() - scanStart;

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

  // License allow/deny lists: explicit policy overrides.
  if (args.denyLicense?.length) {
    const denied = new Set(args.denyLicense.map((l) => l.toUpperCase()));
    for (const [id, info] of report.thirdParty) {
      if (denied.has(id.toUpperCase())) {
        report.findings.push({
          rule: "DENIED-LICENSE",
          severity: "critical",
          title: `License "${id}" is on the deny list`,
          detail: `This license is explicitly prohibited by policy (--deny-license).`,
          license: id,
          file: info.files[0],
          remediation: `Remove or replace the dependency licensed under ${id}, or update the policy.`,
          policy: true,
        } as Finding & { policy?: boolean });
      }
    }
  }
  if (args.allowLicense?.length) {
    const allowed = new Set(args.allowLicense.map((l) => l.toUpperCase()));
    const filtered = report.findings.filter((f) => {
      if (!f.license) return true;
      // A finding for an explicitly allowed license is suppressed.
      return !allowed.has(f.license.toUpperCase());
    });
    if (filtered.length !== report.findings.length && args.quiet !== true) {
      console.error(`note: ${report.findings.length - filtered.length} finding(s) suppressed by --allow-license`);
    }
    report.findings = filtered;
  }
  report.findings.sort((a, b) => severityRank(a.severity) - severityRank(b.severity));
  report.score = complianceScore(report.findings);

  // Re-evaluate rules with the AI-augmented license sets (no re-walk needed).
  // Policy findings added above (DENIED-LICENSE) are preserved: they carry a
  // `policy: true` marker and are re-appended after re-evaluation.
  if (aiCfg) {
    const policyFindings = report.findings.filter((f) => (f as { policy?: boolean }).policy);
    const ctx = buildContext({
      projectLicenses: report.projectLicenses,
      thirdParty: report.thirdParty,
      proprietary: ![...report.projectLicenses.values()].some(
        (i) => i.category === "strong-copyleft" || i.category === "weak-copyleft"
      ),
      root: report.root,
    });
    ctx.hasNoticeFile = report.licenseFiles.some((h) => /^(NOTICE|THIRD[-_ ]?PARTY|LEGAL)/i.test(path.basename(h.file)));
    report.findings = [...evaluate(ctx), ...policyFindings];
    report.score = complianceScore(report.findings);
  }

  // Severity filter (affects both report and exit-code decisions).
  if (args.minSeverity) {
    const min = SEV_ORDER.indexOf(args.minSeverity);
    if (min >= 0) report.findings = report.findings.filter((f) => SEV_ORDER.indexOf(f.severity) >= min);
  }

  // ---- Report output MUST happen before gates return, so `--fail-on-*` with
  // `-o file` still produces the report file for CI to upload. ----
  let out: string;
  (globalThis as { __SECULAR_VERSION__?: string }).__SECULAR_VERSION__ = VERSION;
  if (args.summary) {
    const topSev = report.findings[0]?.severity ?? null;
    out = `${report.score}/100 · ${report.filesScanned} files · ${report.findings.length} finding${report.findings.length === 1 ? "" : "s"}${topSev ? ` (worst: ${topSev})` : ""} · ${report.scanDurationMs ?? 0}ms`;
  } else {
    switch (args.format) {
      case "json": out = toJson(report, { includeLicenseFiles: args.includeLicenseFiles }); break;
      case "markdown": out = toMarkdown(report); break;
      case "sarif": out = toSarif(report); break;
      default: out = terminal(report, { color: useColor(args.noColor) });
    }
  }

  if (args.output) {
    writeOutput(out, args.output);
  } else {
    console.log(out);
  }

  // ---- Exit-code logic (all gates evaluated AFTER output is emitted) ----
  // Category gating: exit 1 if any discovered license matches a listed category.
  if (args.failOnCategory?.length) {
    const cats = new Set(args.failOnCategory);
    const hitCategories = [
      ...[...report.projectLicenses.values()].map((v) => v.category),
      ...[...report.thirdParty.values()].map((v) => v.category),
    ];
    if (hitCategories.some((c) => cats.has(c))) return 1;
  }
  // Unknown-license gating: fail when any license text went unidentified.
  if (args.failOnUnknown && report.licenseFiles.some((h) => !h.id)) return 1;
  // 1) --strict: any finding at/above threshold fails (minSeverity already
  //    applied to report.findings).
  if (args.strict && report.findings.length > 0) return 1;
  // 2) --fail-on-rule: named rules fail regardless of severity.
  if (args.failOnRule?.length && report.findings.some((f) => args.failOnRule!.includes(f.rule))) return 1;
  // 3) --fail-on-score: score below threshold fails.
  if (args.failOnScore !== undefined && report.score < args.failOnScore) return 1;
  // 4) Default: any critical finding fails.
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
