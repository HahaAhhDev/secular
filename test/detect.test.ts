/**
 * Test suite for Secular's core engines: normalization, fingerprinting,
 * manifest parsers, walker, rules engine, and reporting.
 *
 * Run: npm test  (requires `npm run build` first — tests import dist/)
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const { normalize, shingles, containment, buildIndex, identify } = await import("../dist/detect.js");
const { parsePackageJson, parseGoMod, parseCargoToml, parsePyproject, parseGemfile, parseComposerJson } = await import("../dist/manifests.js");
const { evaluate, complianceScore } = await import("../dist/rules.js");
const { getMeta, categoryLabel } = await import("../dist/meta.js");
const { walk } = await import("../dist/walker.js");
const { toJson, toMarkdown, toSarif, toNotices } = await import("../dist/report.js");
const { resolveAiConfig, PROVIDERS } = await import("../dist/ai.js");

const LICENSES_URL = "https://cdn.jsdelivr.net/npm/spdx-license-list@6/spdx-full.json";
const cat = await (await fetch(LICENSES_URL)).json();
const catalog = {
  licenseListVersion: "test",
  licenses: Object.entries(cat).map(([licenseId, e]: [string, { name: string; licenseText: string; deprecated?: boolean }]) => ({
    licenseId,
    name: e.name,
    licenseText: e.licenseText,
    isDeprecatedLicenseId: e.deprecated,
  })),
};

// ---------- normalize ----------
test("normalize lowercases, strips punctuation and copyright lines", () => {
  const out = normalize("Copyright (C) 2020-2024 Foo Corp.\n  THE SOFTWARE.");
  assert.equal(out, "foo corp the software");
});

test("normalize strips bracketed placeholders", () => {
  assert.ok(!normalize("[year] [name] <email>").includes("year"));
});

// ---------- shingles / containment ----------
test("shingles: identical text → containment 1", () => {
  const a = shingles("the quick brown fox jumps over the lazy dog again");
  assert.equal(containment(a, a), 1);
});

test("shingles: disjoint text → containment 0", () => {
  const a = shingles("alpha beta gamma delta epsilon zeta eta theta");
  const b = shingles("one two three four five six seven eight");
  assert.equal(containment(a, b), 0);
});

// ---------- identify ----------
const deprecatedIds = new Set(catalog.licenses.filter((l) => l.isDeprecatedLicenseId).map((l) => l.licenseId));
const index = buildIndex(catalog);

test("identify: full MIT text → MIT", () => {
  const text = catalog.licenses.find((l) => l.licenseId === "MIT").licenseText;
  const m = identify(text, index, deprecatedIds);
  assert.ok(m.length > 0);
  assert.equal(m[0].id, "MIT");
});

test("identify: truncated MIT text → MIT (not MIT-0)", () => {
  const full = catalog.licenses.find((l) => l.licenseId === "MIT").licenseText;
  // Take roughly the first half of the license
  const truncated = full.slice(0, Math.floor(full.length / 2));
  const m = identify(truncated, index, deprecatedIds);
  assert.ok(m.length > 0);
  assert.equal(m[0].id, "MIT", `got ${m[0].id} at ${m[0].score}`);
});

test("identify: full GPL-3.0 text → GPL-3.0-only (canonical)", () => {
  const text = catalog.licenses.find((l) => l.licenseId === "GPL-3.0").licenseText;
  const m = identify(text, index, deprecatedIds);
  assert.ok(m.length > 0);
  assert.equal(m[0].id, "GPL-3.0-only");
});

test("identify: Apache-2.0 text → Apache-2.0", () => {
  const text = catalog.licenses.find((l) => l.licenseId === "Apache-2.0").licenseText;
  const m = identify(text, index, deprecatedIds);
  assert.ok(m.length > 0);
  assert.equal(m[0].id, "Apache-2.0");
});

test("identify: garbage text → no match", () => {
  const m = identify("lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore".repeat(3), index, deprecatedIds);
  assert.equal(m.length, 0);
});

test("identify: too-short text → no match", () => {
  assert.equal(identify("MIT", index, deprecatedIds).length, 0);
});

test("identify: ISC text → ISC", () => {
  const text = catalog.licenses.find((l) => l.licenseId === "ISC").licenseText;
  const m = identify(text, index, deprecatedIds);
  assert.equal(m[0].id, "ISC");
});

// ---------- meta ----------
test("getMeta: canonicalizes deprecated GPL short forms", () => {
  assert.equal(getMeta("GPL-3.0+").category, "strong-copyleft");
  assert.equal(getMeta("GPL-2.0").category, "strong-copyleft");
  assert.equal(getMeta("LGPL-2.1+").category, "weak-copyleft");
});

test("getMeta: unknown license → unknown category", () => {
  assert.equal(getMeta("Made-Up-License-9000").category, "unknown");
});

test("getMeta: SSPL is unfree", () => {
  assert.equal(getMeta("SSPL-1.0").category, "unfree");
});

test("categoryLabel covers all categories", () => {
  for (const c of ["public-domain", "permissive", "weak-copyleft", "strong-copyleft", "network-copyleft", "unfree", "unknown"] as const) {
    assert.ok(categoryLabel(c).length > 0);
  }
});

// ---------- manifests ----------
test("parsePackageJson: extracts deps with scopes", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sec-"));
  const file = path.join(dir, "package.json");
  fs.writeFileSync(file, JSON.stringify({
    dependencies: { express: "^4" },
    devDependencies: { typescript: "^5" },
    optionalDependencies: { fsevents: "^2" },
    peerDependencies: { react: "^18" },
  }));
  const deps = parsePackageJson(file, "package.json");
  assert.ok(deps.find((d) => d.name === "express" && d.scope === "dependency"));
  assert.ok(deps.find((d) => d.name === "typescript" && d.scope === "dev"));
  assert.ok(deps.find((d) => d.name === "react" && d.scope === "dependency"));
  fs.rmSync(dir, { recursive: true, force: true });
});

test("parsePackageJson: malformed JSON → empty", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sec-"));
  const file = path.join(dir, "package.json");
  fs.writeFileSync(file, "{not json");
  assert.deepEqual(parsePackageJson(file, "package.json"), []);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("parseGoMod: block and single requires", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sec-"));
  const file = path.join(dir, "go.mod");
  fs.writeFileSync(file, `module example.com/m\n\ngo 1.21\n\nrequire (\n\tgithub.com/gin-gonic/gin v1.9.1\n\tgolang.org/x/text v0.14.0\n)\n\nrequire github.com/pkg/errors v0.9.1\n`);
  const deps = parseGoMod(file, "go.mod");
  const names = deps.map((d) => d.name);
  assert.ok(names.includes("github.com/gin-gonic/gin"));
  assert.ok(names.includes("golang.org/x/text"));
  assert.ok(names.includes("github.com/pkg/errors"));
  assert.ok(!names.some((n) => n.startsWith("v1")), "must not capture version as name");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("parseCargoToml: deps and dev-deps", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sec-"));
  const file = path.join(dir, "Cargo.toml");
  fs.writeFileSync(file, `[package]\nname = "x"\n\n[dependencies]\nserde = "1"\n\n[dev-dependencies]\ncriterion = "0.5"\n`);
  const deps = parseCargoToml(file, "Cargo.toml");
  assert.ok(deps.find((d) => d.name === "serde" && d.scope === "dependency"));
  assert.ok(deps.find((d) => d.name === "criterion" && d.scope === "dev"));
  fs.rmSync(dir, { recursive: true, force: true });
});

test("parsePyproject: dependencies section", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sec-"));
  const file = path.join(dir, "pyproject.toml");
  fs.writeFileSync(file, `[project]\nname = "x"\n\n[project.dependencies]\nrequests = ">=2"\nflask = "*"\n`);
  const deps = parsePyproject(file, "pyproject.toml");
  const names = deps.map((d) => d.name);
  assert.ok(names.includes("requests"));
  assert.ok(names.includes("flask"));
  fs.rmSync(dir, { recursive: true, force: true });
});

test("parseGemfile: gem lines", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sec-"));
  const file = path.join(dir, "Gemfile");
  fs.writeFileSync(file, `source "https://rubygems.org"\ngem "rails", "7.1"\ngem 'puma'\n`);
  const deps = parseGemfile(file, "Gemfile");
  const names = deps.map((d) => d.name);
  assert.ok(names.includes("rails"));
  assert.ok(names.includes("puma"));
  fs.rmSync(dir, { recursive: true, force: true });
});

test("parseComposerJson: require and require-dev", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sec-"));
  const file = path.join(dir, "composer.json");
  fs.writeFileSync(file, JSON.stringify({ require: { "monolog/monolog": "^3" }, "require-dev": { "phpunit/phpunit": "^10" } }));
  const deps = parseComposerJson(file, "composer.json");
  assert.ok(deps.find((d) => d.name === "monolog/monolog" && d.scope === "dependency"));
  assert.ok(deps.find((d) => d.name === "phpunit/phpunit" && d.scope === "dev"));
  fs.rmSync(dir, { recursive: true, force: true });
});

// ---------- walker ----------
test("walk: skips node_modules and .git, finds licenses", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sec-"));
  fs.mkdirSync(path.join(dir, "node_modules", "x"), { recursive: true });
  fs.writeFileSync(path.join(dir, "node_modules", "x", "LICENSE"), "should be skipped");
  fs.writeFileSync(path.join(dir, "LICENSE"), "MIT License\n\nCopyright (c) 2024 X\n\nPermission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files, to deal in the Software without restriction.");
  fs.writeFileSync(path.join(dir, "a.ts"), "// SPDX-License-Identifier: MIT\n");
  fs.writeFileSync(path.join(dir, "package.json"), "{}");
  const files = walk(dir);
  const rels = files.map((f) => f.rel);
  assert.ok(rels.includes("LICENSE"));
  assert.ok(rels.includes("a.ts"));
  assert.ok(rels.includes("package.json"));
  assert.ok(!rels.some((r) => r.startsWith("node_modules")));
  fs.rmSync(dir, { recursive: true, force: true });
});

// ---------- rules ----------
test("complianceScore: clean → 100", () => {
  assert.equal(complianceScore([]), 100);
});

test("complianceScore: one critical → 70", () => {
  const f = [{ rule: "X", severity: "critical" as const, title: "t", detail: "d", remediation: "r" }];
  assert.equal(complianceScore(f), 70);
});

test("complianceScore: floors at 0", () => {
  const f = Array.from({ length: 5 }, () => ({ rule: "X", severity: "critical" as const, title: "t", detail: "d", remediation: "r" }));
  assert.equal(complianceScore(f), 0);
});

test("evaluate: GPL-3.0 third-party in proprietary project → critical", () => {
  const findings = evaluate({
    projectLicenses: new Map(),
    thirdParty: new Map([["GPL-3.0-only", { category: "strong-copyleft", files: ["vendor/gpl/LICENSE"] }]]),
    proprietary: true,
    networkService: false,
  });
  const f = findings.find((x) => x.rule === "COPYLEFT-IN-PROPRIETARY");
  assert.ok(f);
  assert.equal(f.severity, "critical");
  assert.equal(f.license, "GPL-3.0-only");
});

test("evaluate: AGPL in network service → NETWORK-COPYLEFT", () => {
  const findings = evaluate({
    projectLicenses: new Map(),
    thirdParty: new Map([["AGPL-3.0-only", { category: "network-copyleft", files: ["vendor/agpl/LICENSE"] }]]),
    proprietary: true,
    networkService: true,
  });
  assert.ok(findings.find((x) => x.rule === "NETWORK-COPYLEFT"));
});

test("evaluate: permissive-only project → no findings", () => {
  const findings = evaluate({
    projectLicenses: new Map([["MIT", { category: "permissive", file: "LICENSE" }]]),
    thirdParty: new Map([["MIT", { category: "permissive", files: ["vendor/LICENSE"] }]]),
    proprietary: true,
    networkService: false,
    hasNoticeFile: true,
  });
  assert.equal(findings.length, 0);
});

test("evaluate: MIT third-party without NOTICE → MISSING-NOTICE info", () => {
  const findings = evaluate({
    projectLicenses: new Map(),
    thirdParty: new Map([["MIT", { category: "permissive", files: ["vendor/LICENSE"] }]]),
    proprietary: true,
    networkService: false,
    hasNoticeFile: false,
  });
  const f = findings.find((x) => x.rule === "MISSING-NOTICE");
  assert.ok(f);
  assert.equal(f.severity, "info");
});

test("evaluate: MIT third-party WITH NOTICE → no MISSING-NOTICE", () => {
  const findings = evaluate({
    projectLicenses: new Map(),
    thirdParty: new Map([["MIT", { category: "permissive", files: ["vendor/LICENSE"] }]]),
    proprietary: true,
    networkService: false,
    hasNoticeFile: true,
  });
  assert.ok(!findings.find((x) => x.rule === "MISSING-NOTICE"));
});

test("evaluate: unfree license → critical NON-OPEN-LICENSE", () => {
  const findings = evaluate({
    projectLicenses: new Map(),
    thirdParty: new Map([["CC-BY-NC-4.0", { category: "unfree", files: ["x/LICENSE"] }]]),
    proprietary: true,
    networkService: false,
  });
  const f = findings.find((x) => x.rule === "NON-OPEN-LICENSE");
  assert.ok(f);
  assert.equal(f.severity, "critical");
});

test("evaluate: unknown license → UNKNOWN-LICENSE warning", () => {
  const findings = evaluate({
    projectLicenses: new Map(),
    thirdParty: new Map([["Custom-Thing", { category: "unknown", files: ["x/LICENSE"] }]]),
    proprietary: true,
    networkService: false,
  });
  assert.ok(findings.find((x) => x.rule === "UNKNOWN-LICENSE"));
});

test("evaluate: findings sorted by severity", () => {
  const findings = evaluate({
    projectLicenses: new Map([["SSPL-1.0", { category: "unfree", file: "LICENSE" }]]),
    thirdParty: new Map([
      ["MPL-2.0", { category: "weak-copyleft", files: ["a"] }],
      ["GPL-3.0-only", { category: "strong-copyleft", files: ["b"] }],
    ]),
    proprietary: true,
    networkService: false,
  });
  const order = { critical: 0, error: 1, warning: 2, info: 3 };
  for (let i = 1; i < findings.length; i++) {
    assert.ok(order[findings[i].severity] >= order[findings[i - 1].severity]);
  }
});

// ---------- ai config ----------
test("resolveAiConfig: provider guessed from key prefix", () => {
  const cfg = resolveAiConfig({ apiKey: "sk-ant-api03-xxx" });
  assert.equal(cfg.baseUrl, PROVIDERS.anthropic.baseUrl);
  const cfg2 = resolveAiConfig({ apiKey: "sk-or-xxx" });
  assert.equal(cfg2.baseUrl, PROVIDERS.openrouter.baseUrl);
  const cfg3 = resolveAiConfig({ apiKey: "sk-plain" });
  assert.equal(cfg3.baseUrl, PROVIDERS.openai.baseUrl);
});

test("resolveAiConfig: no key → null", () => {
  const saved = [process.env.SECULAR_API_KEY, process.env.OPENAI_API_KEY, process.env.ANTHROPIC_API_KEY];
  delete process.env.SECULAR_API_KEY;
  delete process.env.OPENAI_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  assert.equal(resolveAiConfig({}), null);
  process.env.SECULAR_API_KEY = saved[0];
  process.env.OPENAI_API_KEY = saved[1];
  process.env.ANTHROPIC_API_KEY = saved[2];
});

test("resolveAiConfig: unknown provider falls back to openai", () => {
  const cfg = resolveAiConfig({ apiKey: "sk-x", provider: "made-up" });
  assert.equal(cfg.baseUrl, PROVIDERS.openai.baseUrl);
});

// ---------- report ----------
// Typed as any-shaped fixture: report emitters accept ScanReport; the test
// fixtures use plain strings for enum-like fields.
const sampleReport: any = {
  root: "/tmp/x",
  filesScanned: 3,
  licenseFiles: [],
  projectLicenses: new Map([["MIT", { category: "permissive", file: "LICENSE" }]]),
  thirdParty: new Map([["GPL-3.0-only", { category: "strong-copyleft", files: ["vendor/LICENSE"] }]]),
  dependencies: [{ name: "express", scope: "dependency", ecosystem: "npm", source: "package.json" }],
  findings: [
    {
      rule: "COPYLEFT-IN-PROPRIETARY",
      severity: "critical",
      title: 'Strong copyleft license "GPL-3.0-only" found in a proprietary codebase',
      detail: "GPL obligations apply.",
      license: "GPL-3.0-only",
      file: "vendor/LICENSE",
      remediation: "Remove or isolate.",
    },
  ],
  score: 70,
  catalogVersion: "test",
  usedAi: false,
};

test("toJson: emits valid JSON with expected fields", () => {
  const j = JSON.parse(toJson(sampleReport));
  assert.equal(j.tool, "secular");
  assert.equal(j.score, 70);
  assert.equal(j.projectLicenses.MIT.category, "permissive");
  assert.ok(j.findings.length === 1);
});

test("toMarkdown: includes findings and licenses", () => {
  const md = toMarkdown(sampleReport);
  assert.ok(md.includes("# Secular License Compliance Report"));
  assert.ok(md.includes("GPL-3.0-only"));
  assert.ok(md.includes("COPYLEFT-IN-PROPRIETARY"));
});

test("toSarif: valid SARIF 2.1.0 structure", () => {
  const s = JSON.parse(toSarif(sampleReport));
  assert.equal(s.version, "2.1.0");
  assert.equal(s.runs[0].tool.driver.name, "secular");
  assert.equal(s.runs[0].results[0].ruleId, "COPYLEFT-IN-PROPRIETARY");
  assert.equal(s.runs[0].results[0].level, "error");
  assert.ok(s.runs[0].results[0].locations[0].physicalLocation.artifactLocation.uri.includes("vendor/LICENSE"));
});

test("toSarif: warning severity maps to warning level", () => {
  const r = { ...sampleReport, findings: [{ ...sampleReport.findings[0], severity: "warning", rule: "WEAK-COPYLEFT" }] };
  const s = JSON.parse(toSarif(r));
  assert.equal(s.runs[0].results[0].level, "warning");
});

test("toNotices: lists third-party licenses", () => {
  const n = toNotices(sampleReport);
  assert.ok(n.includes("GPL-3.0-only"));
  assert.ok(n.includes("vendor/LICENSE"));
});

test("toNotices: empty third-party → placeholder", () => {
  const n = toNotices({ ...sampleReport, thirdParty: new Map() });
  assert.ok(n.includes("No third-party license files detected"));
});

// ---------- walker: exclude + symlinks ----------
const { VENDOR_DIRS } = await import("../dist/walker.js");

test("walk: exclude skips directories by name", async () => {
  const { walk } = await import("../dist/walker.js");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sec-exc-"));
  fs.mkdirSync(path.join(dir, "skipme"), { recursive: true });
  fs.mkdirSync(path.join(dir, "keep"), { recursive: true });
  fs.writeFileSync(path.join(dir, "skipme", "a.ts"), "// x");
  fs.writeFileSync(path.join(dir, "keep", "b.ts"), "// y");
  const without = walk(dir).map((f: { rel: string }) => f.rel);
  assert.ok(without.includes("skipme/a.ts"));
  const withEx = walk(dir, 50_000, { exclude: ["skipme"] }).map((f: { rel: string }) => f.rel);
  assert.ok(!withEx.includes("skipme/a.ts"));
  assert.ok(withEx.includes("keep/b.ts"));
  fs.rmSync(dir, { recursive: true, force: true });
});

test("walk: symlink loops do not hang", async () => {
  const { walk } = await import("../dist/walker.js");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sec-loop-"));
  fs.mkdirSync(path.join(dir, "inner"));
  fs.writeFileSync(path.join(dir, "inner", "a.ts"), "// x");
  try {
    fs.symlinkSync(path.join(dir, "inner"), path.join(dir, "inner", "loop"), "dir");
  } catch {
    // Windows without privileges: skip
  }
  // Must terminate quickly instead of looping forever.
  const files = walk(dir);
  assert.ok(files.every((f: { rel: string }) => f.rel.split("/").filter((p) => p === "loop").length <= 2));
  fs.rmSync(dir, { recursive: true, force: true });
});

test("walk: license files inside vendor dirs are found, vendor source is not", async () => {
  const { walk } = await import("../dist/walker.js");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sec-vendor-"));
  fs.mkdirSync(path.join(dir, "vendor", "lib"), { recursive: true });
  fs.writeFileSync(path.join(dir, "vendor", "lib", "LICENSE"), "MIT License");
  fs.writeFileSync(path.join(dir, "vendor", "lib", "code.js"), "module.exports = 1;");
  const rels = walk(dir).map((f: { rel: string }) => f.rel);
  assert.ok(rels.includes("vendor/lib/LICENSE"));
  assert.ok(!rels.includes("vendor/lib/code.js"));
  fs.rmSync(dir, { recursive: true, force: true });
});

// ---------- walker: bundled runtime / module dirs ----------
test("walk: bundled runtime dirs (python-3.12.7, cpython-3.12, jdk-21) are skipped entirely", async () => {
  const { walk } = await import("../dist/walker.js");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sec-rt-"));
  for (const rt of ["python-3.12.7", "cpython-3.12.4+", "jdk-21.0.2", "node-v20.11.0", "miniconda3", "python312"]) {
    fs.mkdirSync(path.join(dir, rt), { recursive: true });
    fs.writeFileSync(path.join(dir, rt, "LICENSE"), "runtime license should be skipped");
  }
  fs.writeFileSync(path.join(dir, "LICENSE"), "MIT License\n\nreal project license");
  const rels = walk(dir).map((f: { rel: string }) => f.rel);
  assert.deepEqual(rels.filter((r: string) => r !== "LICENSE"), [], `got: ${rels}`);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("walk: site-packages / node_modules inside a project are skipped", async () => {
  const { walk } = await import("../dist/walker.js");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sec-pkg-"));
  fs.mkdirSync(path.join(dir, "lib", "site-packages", "somepkg"), { recursive: true });
  fs.writeFileSync(path.join(dir, "lib", "site-packages", "somepkg", "LICENSE"), "skip me");
  fs.writeFileSync(path.join(dir, "main.py"), "x = 1");
  const rels = walk(dir).map((f: { rel: string }) => f.rel);
  assert.ok(!rels.some((r: string) => r.includes("site-packages")));
  assert.ok(rels.includes("main.py"));
  fs.rmSync(dir, { recursive: true, force: true });
});

test("walk: unnamed runtime dir containing python3 binary is skipped", async () => {
  const { walk } = await import("../dist/walker.js");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sec-bin-"));
  const rt = path.join(dir, "tools", "py-runtime-2024");
  fs.mkdirSync(rt, { recursive: true });
  fs.writeFileSync(path.join(rt, "python3"), "#!/bin/sh\n");
  fs.writeFileSync(path.join(rt, "LICENSE.PYTHON"), "PSF license should be skipped");
  fs.writeFileSync(path.join(dir, "app.py"), "x = 1");
  const rels = walk(dir).map((f: { rel: string }) => f.rel);
  assert.ok(!rels.some((r: string) => r.includes("py-runtime-2024")), `got: ${rels}`);
  assert.ok(rels.includes("app.py"));
  fs.rmSync(dir, { recursive: true, force: true });
});

test("walk: deep nesting terminates (depth cap)", async () => {
  const { walk } = await import("../dist/walker.js");
  let dir = fs.mkdtempSync(path.join(os.tmpdir(), "sec-deep-"));
  let cur = dir;
  for (let i = 0; i < 80; i++) {
    cur = path.join(cur, "n");
    fs.mkdirSync(cur);
  }
  fs.writeFileSync(path.join(cur, "a.ts"), "// deep");
  const files = walk(dir); // must not hang
  assert.ok(files.every((f: { rel: string }) => f.rel.split("/").length <= 65));
  fs.rmSync(dir, { recursive: true, force: true });
});

test("manifests: oversized package.json is ignored safely", async () => {
  const { parsePackageJson } = await import("../dist/manifests.js");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sec-big-"));
  const file = path.join(dir, "package.json");
  fs.writeFileSync(file, JSON.stringify({ dependencies: Object.fromEntries(
    Array.from({ length: 140_000 }, (_, i) => [`pkg-${i}`, "*"])
  ) }));
  // > 2MB → treated as not-a-manifest rather than parsed
  assert.equal(parsePackageJson(file, "package.json").length, 0);
  fs.rmSync(dir, { recursive: true, force: true });
});

// ---------- report: color toggle + json extras ----------
test("terminal: --no-color produces no ANSI escape codes", async () => {
  const { terminal } = await import("../dist/report.js");
  const plain = terminal(sampleReport, { color: false });
  assert.ok(!plain.includes("\x1b["), "no escape codes expected");
  const colored = terminal(sampleReport, { color: true });
  assert.ok(colored.includes("\x1b["), "escape codes expected with color on");
});

test("toJson: includeLicenseFiles adds per-file data", async () => {
  const { toJson } = await import("../dist/report.js");
  const r = { ...sampleReport, licenseFiles: [{ file: "LICENSE", matches: [], id: "MIT", score: 1, excerpt: "x" }] };
  const without = JSON.parse(toJson(r));
  assert.ok(!("licenseFiles" in without));
  const withFiles = JSON.parse(toJson(r, { includeLicenseFiles: true }));
  assert.equal(withFiles.licenseFiles[0].license, "MIT");
  assert.equal(withFiles.licenseFiles[0].file, "LICENSE");
});
