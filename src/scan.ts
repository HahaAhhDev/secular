/**
 * Scan orchestration: walk the repo, identify licenses, parse manifests,
 * apply rules, and emit a structured report.
 */

import fs from "node:fs";
import path from "node:path";
import { walk, type FoundFile } from "./walker.js";
import { buildIndex, identify, type FingerprintMatch } from "./detect.js";
import { loadCatalog, type SpdxCatalog } from "./spdx.js";
import { getMeta, type Category } from "./meta.js";
import { evaluate, complianceScore, type Finding, type ScanContext } from "./rules.js";
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
}

export interface ScanOptions {
  root: string;
  /** Pre-loaded catalog (avoids refetching in tests). */
  catalog?: SpdxCatalog;
  refreshCatalog?: boolean;
  /** Proprietary assumption — defaults to heuristic. */
  proprietary?: boolean;
}

export async function scan(opts: ScanOptions): Promise<ScanReport> {
  const root = path.resolve(opts.root);
  if (!fs.existsSync(root)) {
    throw new Error(`directory not found: ${root}`);
  }
  if (!fs.statSync(root).isDirectory()) {
    throw new Error(`not a directory: ${root}`);
  }
  const catalog = opts.catalog ?? (await loadCatalog({ refresh: opts.refreshCatalog }));
  const deprecatedIds = new Set(catalog.licenses.filter((l) => l.isDeprecatedLicenseId).map((l) => l.licenseId));
  const index = buildIndex(catalog);

  const files = walk(root);
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
    const hit: LicenseHit = {
      file: f.rel,
      matches,
      id: best && best.score >= 0.7 ? best.id : undefined,
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

  const ctx: ScanContext = {
    projectLicenses,
    thirdParty,
    proprietary,
    networkService,
    hasNoticeFile: files.some(
      (f) => f.kind === "license" && /(^|\/)(NOTICE|THIRD[-_ ]?PARTY|LEGAL)/i.test(path.basename(f.rel))
    ),
  };
  const findings = evaluate(ctx);
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
