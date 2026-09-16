/**
 * Scan orchestration: walk the repo, identify licenses, parse manifests,
 * apply rules, and emit a structured report.
 */

import fs from "node:fs";
import path from "node:path";
import { walk, resetLastSkipped, lastSkipped, type SkipMode, type SkippedDir, type FoundFile } from "./walker.js";
import { buildIndex, identify, type FingerprintMatch } from "./detect.js";
import { loadCatalog, type SpdxCatalog } from "./spdx.js";
import { getMeta, type Category } from "./meta.js";
import { evaluate, complianceScore, severityRank, type Finding, type ScanContext } from "./rules.js";
import {
  parsePackageJson, parseCargoToml, parseGoMod, parsePyproject, parseGemfile, parseComposerJson,
  type Dep,
} from "./manifests.js";

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
  projectLicenses: Map<string, { category: Category; file?: string }>;
  thirdParty: Map<string, { category: Category; files: string[] }>;
  dependencies: Dep[];
  findings: Finding[];
  score: number;
  catalogVersion: string;
  usedAi: boolean;
  /** Wall-clock scan duration in milliseconds (set by the CLI). */
  scanDurationMs?: number;
  /** Dependency-audit mismatches (declared dep with no disk license found). */
  depAudit?: { name: string; ecosystem: string; issue: "no-license-file" }[];
}

export interface ScanOptions {
  root: string;
  /** Pre-loaded catalog (avoids refetching in tests). */
  catalog?: SpdxCatalog;
  refreshCatalog?: boolean;
  /** Proprietary assumption — defaults to heuristic. */
  proprietary?: boolean;
  /** Directory names to skip entirely during the walk. */
  exclude?: string[];
  /** File names to skip (basename match, case-insensitive). */
  excludeFiles?: string[];
  /** Cap on files walked. */
  maxFiles?: number;
  /** Minimum fingerprint confidence to accept a match (overrides root/nested defaults). */
  minScore?: number;
  /** SPDX ids whose findings are suppressed (policy allowlist). */
  allowLicenses?: string[];
  /** SPDX ids that are outright prohibited (policy denylist). */
  denyLicenses?: string[];
  /** Cross-check manifest dependencies against discovered disk licenses. */
  depAudit?: boolean;
  /** Skip license collection inside vendor dirs entirely. */
  noVendorScan?: boolean;
  /** Also scan hidden (dot-prefixed) directories. */
  includeHidden?: boolean;
  /** What to do with auto-detected skip candidates: auto | scan | ask. */
  skipMode?: SkipMode;
  /** Called in "ask" mode with detected candidates; return "scan" to include, "ignore" to skip. */
  onSkipDecision?: (skipped: SkippedDir[]) => "ignore" | "scan" | void;
  /** Max license files sent for AI adjudication (ai command). */
  maxAdjudicate?: number;
}

export async function scan(opts: ScanOptions): Promise<ScanReport> {
  const root = path.resolve(opts.root);
  let stat: fs.Stats;
  try {
    stat = fs.statSync(root);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "EACCES") throw new Error(`permission denied: ${root}`);
    if (code === "ENOENT") throw new Error(`directory not found: ${root}`);
    throw new Error(`cannot read ${root}: ${(err as Error).message}`);
  }
  if (!stat.isDirectory()) {
    throw new Error(`not a directory: ${root}`);
  }
  const catalog = opts.catalog ?? (await loadCatalog({ refresh: opts.refreshCatalog }));
  const deprecatedIds = new Set(catalog.licenses.filter((l) => l.isDeprecatedLicenseId).map((l) => l.licenseId));
  const index = buildIndex(catalog);

  const skipMode: SkipMode = opts.skipMode ?? "auto";
  resetLastSkipped();
  const files = walk(root, opts.maxFiles ?? 50_000, {
    exclude: opts.exclude,
    excludeFiles: opts.excludeFiles,
    noVendorScan: opts.noVendorScan,
    includeHidden: opts.includeHidden,
    skipMode,
    onSkippedDetected:
      skipMode === "ask" && opts.onSkipDecision
        ? ((detected: SkippedDir[]) => (opts.onSkipDecision!(detected) === "scan" ? null : undefined)) as (s: SkippedDir[]) => SkippedDir[] | null | void
        : undefined,
  });
  const licenseFiles: LicenseHit[] = [];
  const rootLicenses = new Map<string, { category: Category; file?: string }>();
  const projectLicenses = new Map<string, { category: Category; file?: string }>();
  const thirdParty = new Map<string, { category: Category; files: string[] }>();
  const deps: Dep[] = [];

  const isRootLicense = (f: FoundFile) => {
    const base = path.basename(f.rel);
    if (path.dirname(f.rel) !== ".") return false;
    return /^(?:UN)?LICEN[CS]E(\.md|\.txt|\.rst|\.html)?$|^COPYING(\.txt)?$|^NOTICE$|^COPYRIGHT$/i.test(base);
  };

  for (const f of files) {
    if (f.kind === "manifest") {
      deps.push(...parseManifest(f));
      continue;
    }
    if (f.kind !== "license") continue;

    let text: string;
    try {
      text = fs.readFileSync(f.abs, "utf8");
    } catch {
      continue;
    }
    if (text.trim().length < 20) continue;

    const matches = identify(text, index, deprecatedIds);
    const best = matches[0];
    const isRoot = isRootLicense(f);
    // Root LICENSE files drive the compliance verdict, so demand near-exact
    // confidence; vendored files can be lower. Never accept a "partial"
    // superset match on a root file — that's how truncated texts misfire.
    const minScore = opts.minScore ?? (isRoot ? 0.9 : 0.7);
    const acceptable = best && best.score >= minScore && !(isRoot && best.partial);
    const hit: LicenseHit = {
      file: f.rel,
      matches,
      id: acceptable ? best.id : undefined,
      score: best?.score,
      excerpt: text.slice(0, 400),
    };
    licenseFiles.push(hit);

    if (hit.id) {
      if (isRootLicense(f)) {
        rootLicenses.set(hit.id, { category: getMeta(hit.id).category, file: f.rel });
        projectLicenses.set(hit.id, { category: getMeta(hit.id).category, file: f.rel });
      } else {
        // Vendored/nested third-party license
        const existing = thirdParty.get(hit.id);
        if (existing) existing.files.push(f.rel);
        else thirdParty.set(hit.id, { category: getMeta(hit.id).category, files: [f.rel] });
      }
    }
  }

  // Scan source files for inline license headers (first 2KB of each).
  const headerCounts = new Map<string, string[]>();
  let headersChecked = 0;
  for (const f of files) {
    if (f.kind !== "source" || headersChecked > 3000) continue;
    let head: string;
    try {
      const fd = fs.openSync(f.abs, "r");
      const buf = Buffer.alloc(2048);
      const n = fs.readSync(fd, buf, 0, 2048, 0);
      fs.closeSync(fd);
      head = buf.subarray(0, n).toString("utf8");
    } catch {
      continue;
    }
    if (!/(SPDX-License-Identifier|Copyright|Licensed under|Licensed under the)/i.test(head)) continue;
    headersChecked++;
    const spdxTag = head.match(/SPDX-License-Identifier:\s*([A-Za-z0-9.+ -]+)/);
    if (spdxTag) {
      const id = spdxTag[1]!.trim();
      headerCounts.set(id, [...(headerCounts.get(id) ?? []), f.rel]);
      continue;
    }
    const matches = identify(head, index, deprecatedIds);
    const best = matches[0];
    if (best && best.score >= 0.8) {
      headerCounts.set(best.id, [...(headerCounts.get(best.id) ?? []), f.rel]);
    }
  }

  // Inline SPDX headers on first-party code count as project licenses.
  for (const [id, fileList] of headerCounts) {
    const meta = getMeta(id);
    if (meta.category === "unknown") continue;
    const existing = projectLicenses.get(id);
    if (existing) {
      existing.file = existing.file ?? fileList[0];
    } else {
      projectLicenses.set(id, { category: meta.category, file: fileList[0] });
    }
  }

  const proprietary = opts.proprietary ?? heuristicProprietary(root, rootLicenses);
  const networkService = heuristicNetworkService(root);

  const hasNoticeFile = files.some((f) => /^(NOTICE|THIRD[-_ ]?PARTY|LEGAL)/i.test(path.basename(f.rel)));

  // Dependency audit: per-dependency check. A declared dependency is
  // satisfied when a license file exists somewhere under root in a directory
  // named after the dependency (e.g. vendor/express/LICENSE), or when the
  // manifest's own directory tree carries a LICENSE at/above the manifest.
  // Everything else is flagged "no-license-file".
  let depAuditResult: ScanReport["depAudit"] | undefined;
  if (opts.depAudit) {
    const licenseDirs = [...new Set(files.filter((f) => f.kind === "license").map((f) => path.dirname(f.rel)))];
    const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9._/-]/g, "");
    const depName = (n: string) => norm(n.includes("/") ? n.split("/")[1]! : n);
    const satisfied = (dep: Dep): boolean => {
      const base = depName(dep.name);
      // 1) A license directory matching the dep name (vendor/express/LICENSE).
      if (licenseDirs.some((dir) => dir.split("/").some((seg) => norm(seg) === base))) return true;
      // 2) A license at/above the manifest that declares it.
      const mdir = path.dirname(dep.source);
      let cur = mdir;
      while (true) {
        const prefix = cur === "." ? null : `${cur}/`;
        if (licenseDirs.some((dir) => dir === cur || (prefix !== null && dir.startsWith(prefix)))) return true;
        if (cur === ".") break;
        cur = path.dirname(cur);
      }
      return false;
    };
    const flagged = deps.filter((d) => d.scope === "dependency" && !satisfied(d));
    // Dedupe by name+ecosystem (a dep can appear in several manifests).
    const seen = new Set<string>();
    depAuditResult = flagged.filter((d) => {
      const k = `${d.ecosystem}:${d.name}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    }).map((d) => ({ name: d.name, ecosystem: d.ecosystem, issue: "no-license-file" as const }));
    if (depAuditResult.length === 0) depAuditResult = undefined;
  }

  const ctx = buildContext({ projectLicenses, thirdParty, proprietary, root });
  (ctx as { hasNoticeFile?: boolean }).hasNoticeFile = hasNoticeFile;
  let findings = evaluate(ctx);
  // Policy allowlist: suppress findings tied to explicitly allowed licenses.
  if (opts.allowLicenses?.length) {
    const allowed = new Set(opts.allowLicenses.map((l) => l.toUpperCase()));
    findings = findings.filter((f) => !f.license || !allowed.has(f.license.toUpperCase()));
  }
  // Policy denylist: prohibited licenses are always critical findings.
  if (opts.denyLicenses?.length) {
    const denied = new Set(opts.denyLicenses.map((l) => l.toUpperCase()));
    for (const [id, info] of thirdParty) {
      if (denied.has(id.toUpperCase()) && !findings.some((f) => f.license === id)) {
        findings.push({
          rule: "DENIED-LICENSE",
          severity: "critical",
          title: `License "${id}" is on the deny list`,
          detail: `This license is explicitly prohibited by policy (--deny-license).`,
          license: id,
          file: info.files[0],
          remediation: `Remove or replace the dependency licensed under ${id}, or update the policy.`,
        });
      }
    }
    findings.sort((a, b) => severityRank(a.severity) - severityRank(b.severity));
  }
  const score = complianceScore(findings);

  return {
    root,
    filesScanned: files.length,
    licenseFiles,
    projectLicenses,
    thirdParty,
    dependencies: deps,
    findings,
    score,
    catalogVersion: catalog.licenseListVersion,
    usedAi: false,
    depAudit: depAuditResult,
  };
}

export function getSkippedDirs(): SkippedDir[] {
  return lastSkipped;
}

/** Shared context builder so CLI re-evaluation matches scan-time logic exactly. */
export function buildContext(input: {
  projectLicenses: ScanContext["projectLicenses"];
  thirdParty: ScanContext["thirdParty"];
  proprietary: boolean;
  root: string;
}): ScanContext {
  return {
    projectLicenses: input.projectLicenses,
    thirdParty: input.thirdParty,
    proprietary: input.proprietary,
    networkService: heuristicNetworkService(input.root),
  };
}

function parseManifest(f: FoundFile): Dep[] {
  const base = path.basename(f.abs);
  try {
    if (base === "package.json") return parsePackageJson(f.abs, f.rel);
    if (base === "Cargo.toml") return parseCargoToml(f.abs, f.rel);
    if (base === "go.mod") return parseGoMod(f.abs, f.rel);
    if (base === "pyproject.toml") return parsePyproject(f.abs, f.rel);
    if (base === "Gemfile") return parseGemfile(f.abs, f.rel);
    if (base === "composer.json") return parseComposerJson(f.abs, f.rel);
  } catch {
    /* ignore */
  }
  return [];
}

function heuristicProprietary(root: string, rootLicenses: Map<string, { category: Category }>): boolean {
  // If there's no root LICENSE at all, assume proprietary/closed-source context.
  if (rootLicenses.size === 0) return true;
  // A root LICENSE that is permissive/public-domain/copyleft implies open-source intent;
  // third-party copyleft findings still get flagged by the rules engine.
  return false;
}

export function heuristicNetworkService(root: string): boolean {
  try {
    const pkg = path.join(root, "package.json");
    if (fs.existsSync(pkg)) {
      const p = JSON.parse(fs.readFileSync(pkg, "utf8"));
      const all = { ...(p.dependencies ?? {}), ...(p.devDependencies ?? {}) };
      if (all.express || all.fastify || all.koa || all["@hono/node-server"] || all.next || all.nuxt) return true;
    }
    const req = path.join(root, "requirements.txt");
    if (fs.existsSync(req)) {
      const t = fs.readFileSync(req, "utf8");
      if (/flask|django|fastapi|uvicorn|starlette/i.test(t)) return true;
    }
    const go = path.join(root, "go.mod");
    if (fs.existsSync(go)) {
      const t = fs.readFileSync(go, "utf8");
      if (/gin-gonic|echo|fiber|chi|gorilla\/mux/i.test(t)) return true;
    }
  } catch {
    /* ignore */
  }
  return false;
}
