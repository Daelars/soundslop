/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require("fs");
const path = require("path");

const repoRoot = path.resolve(__dirname, "..");
const nextConfigPath = path.join(repoRoot, "next.config.ts");
const lockfiles = ["bun.lock", "package-lock.json", "pnpm-lock.yaml", "yarn.lock"];

function hasExplicitTurbopackRoot(configSource) {
  return /turbopack\s*:\s*\{[\s\S]*\broot\s*:/.test(configSource);
}

function findAncestorLockfiles(startDir) {
  const found = [];
  let current = path.dirname(startDir);
  let previous = null;

  while (current && current !== previous) {
    for (const filename of lockfiles) {
      const filePath = path.join(current, filename);
      if (fs.existsSync(filePath)) {
        found.push(filePath);
      }
    }

    previous = current;
    current = path.dirname(current);
  }

  return found;
}

if (!fs.existsSync(nextConfigPath)) {
  console.error(`Missing Next config: ${nextConfigPath}`);
  process.exit(1);
}

const nextConfigSource = fs.readFileSync(nextConfigPath, "utf8");

if (!hasExplicitTurbopackRoot(nextConfigSource)) {
  console.error("Refusing to start: next.config.ts must define turbopack.root to keep Next scoped to this repo.");
  process.exit(1);
}

const ancestorLockfiles = findAncestorLockfiles(repoRoot);

if (ancestorLockfiles.length > 0) {
  console.warn("Workspace root guard: ancestor lockfiles detected.");
  for (const filePath of ancestorLockfiles) {
    console.warn(`- ${filePath}`);
  }
  console.warn("Explicit turbopack.root is set, so Next should stay scoped to this repository.");
}
