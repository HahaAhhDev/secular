/**
 * Dependency manifest parsing. Extracts declared license fields where present
 * (license notes) and, critically, the DEPENDENCY LISTS that need attribution.
 */
import fs from "node:fs";
export function parsePackageJson(abs, source) {
    try {
        const pkg = JSON.parse(fs.readFileSync(abs, "utf8"));
        if (!pkg || typeof pkg !== "object" || Array.isArray(pkg))
            return [];
        const deps = [];
        const add = (obj, scope) => {
            if (!obj || typeof obj !== "object" || Array.isArray(obj))
                return;
            for (const name of Object.keys(obj)) {
                if (!name)
                    continue;
                deps.push({ name, scope, ecosystem: "npm", source });
            }
        };
        add(pkg.dependencies, "dependency");
        add(pkg.optionalDependencies, "dependency");
        add(pkg.peerDependencies, "dependency");
        add(pkg.devDependencies, "dev");
        return deps;
    }
    catch {
        return [];
    }
}
export function parseCargoToml(abs, source) {
    try {
        const text = fs.readFileSync(abs, "utf8");
        const deps = [];
        let section = "";
        for (const line of text.split(/\r?\n/)) {
            const sec = line.match(/^\s*\[([^\]]+)\]/);
            if (sec) {
                section = sec[1].trim();
                continue;
            }
            const entry = section.match(/^(?:dependencies|dev-dependencies|build-dependencies)$/)
                ? line.match(/^\s*([A-Za-z0-9_.-]+)\s*=/)
                : null;
            if (entry) {
                deps.push({
                    name: entry[1],
                    scope: section === "dev-dependencies" ? "dev" : "dependency",
                    ecosystem: "cargo",
                    source,
                });
            }
        }
        return deps;
    }
    catch {
        return [];
    }
}
export function parseGoMod(abs, source) {
    try {
        const text = fs.readFileSync(abs, "utf8");
        const deps = [];
        let inRequireBlock = false;
        for (const line of text.split(/\r?\n/)) {
            const t = line.trim();
            if (/^require\s*\(/.test(t)) {
                inRequireBlock = true;
                continue;
            }
            if (inRequireBlock && /^\)/.test(t)) {
                inRequireBlock = false;
                continue;
            }
            const m = inRequireBlock
                ? t.match(/^([A-Za-z0-9._/-]+\.[A-Za-z]{2,}\/[^\s]+)\s+(v\d)/)
                : t.match(/^require\s+([A-Za-z0-9._/-]+\.[A-Za-z]{2,}\/[^\s]+)\s+(v\d)/);
            const name = m?.[1];
            if (name)
                deps.push({ name, scope: "dependency", ecosystem: "go", source });
        }
        return deps;
    }
    catch {
        return [];
    }
}
export function parsePyproject(abs, source) {
    try {
        const text = fs.readFileSync(abs, "utf8");
        const deps = [];
        let inDeps = false;
        for (const line of text.split(/\r?\n/)) {
            if (/^\s*\[/.test(line)) {
                inDeps = /^\s*\[(?:project\.)?dependencies\]/.test(line);
                continue;
            }
            if (!inDeps)
                continue;
            const m = line.match(/^\s*"?\)?([A-Za-z0-9_.\[\]-]+)\s*(?:[=<>!~])/);
            if (m)
                deps.push({ name: m[1].split("[")[0].trim(), scope: "dependency", ecosystem: "pypi", source });
            else {
                const name = line.match(/^\s*([A-Za-z0-9_.-]+)\s*$/);
                if (name)
                    deps.push({ name: name[1], scope: "dependency", ecosystem: "pypi", source });
            }
        }
        return deps;
    }
    catch {
        return [];
    }
}
export function parseGemfile(abs, source) {
    try {
        const text = fs.readFileSync(abs, "utf8");
        const deps = [];
        for (const line of text.split(/\r?\n/)) {
            const m = line.match(/^\s*gem\s+["']([^"']+)["']/);
            if (m)
                deps.push({ name: m[1], scope: "dependency", ecosystem: "rubygems", source });
        }
        return deps;
    }
    catch {
        return [];
    }
}
export function parseComposerJson(abs, source) {
    try {
        const pkg = JSON.parse(fs.readFileSync(abs, "utf8"));
        const deps = [];
        const add = (obj, scope) => {
            if (!obj || typeof obj !== "object")
                return;
            for (const name of Object.keys(obj)) {
                if (name === "php" || name.includes("/")) {
                    deps.push({ name, scope, ecosystem: "packagist", source });
                }
            }
        };
        add(pkg.require, "dependency");
        add(pkg["require-dev"], "dev");
        return deps;
    }
    catch {
        return [];
    }
}
