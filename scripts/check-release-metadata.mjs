import {parse} from "yaml";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { EXPECTED_PACKAGE_NAME, EXPECTED_REPOSITORY, SEMVER } from "./release-metadata.mjs";

async function json(path) {
	return JSON.parse(await readFile(path, "utf8"));
}

const [pkg, lock, patch, client, readme] = await Promise.all([
	json("package.json"),
	readFile("pnpm-lock.yaml", "utf8").then(parse),
	readFile("cordis.patch.yml", "utf8"),
	readFile("lib/client.js", "utf8"),
	readFile("README.md", "utf8")
]);

assert.equal(pkg.name, EXPECTED_PACKAGE_NAME, "unexpected scoped npm package identity");
assert.match(pkg.version, SEMVER, "package version must be valid SemVer");
assert.equal(pkg.repository?.url, EXPECTED_REPOSITORY, "repository metadata drifted");
assert.equal(pkg.homepage, "https://github.com/iBobbyTS/dsh-usage-stats#readme", "homepage metadata drifted");
assert.equal(pkg.bugs, "https://github.com/iBobbyTS/dsh-usage-stats/issues", "bugs metadata drifted");
assert.equal(pkg.publishConfig?.access, "public", "scoped package must publish with public access");
assert.equal(pkg.main, "lib/index.js");
assert.equal(pkg.exports?.["."], "./lib/index.js");
assert.equal(pkg.exports?.["./client"], "./lib/client.js");
assert.equal(pkg.dsh?.bundle?.patch, "./cordis.patch.yml");
assert.equal(pkg.dsh?.client?.platform, "web");
for (const required of ["lib/", "cordis.patch.yml", "README.md", "LICENSE", "SECURITY.md", "docs/release-checklist.md", "docs/release-notes-v0.3.0.md"]) {
	assert.ok(pkg.files?.includes(required), `npm files is missing ${required}`);
}
// Prerelease builds share the target stable version's release notes.
const releaseNotes = `docs/release-notes-v${pkg.version.replace(/[-+].*$/, "")}.md`;
assert.ok(pkg.files?.includes(releaseNotes), `npm files is missing current release notes: ${releaseNotes}`);
await readFile(releaseNotes, "utf8");

for (const group of ['dependencies','devDependencies','optionalDependencies']) {
 for (const [name,specifier] of Object.entries(pkg[group] ?? {})) {
  assert.equal(lock.importers?.['.']?.[group]?.[name]?.specifier,specifier, `pnpm lock specifier drift: ${name}`)
 }
}
assert.match(pkg.packageManager,/^pnpm@\d+\.\d+\.\d+$/);

const escapedName = pkg.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
assert.match(patch, new RegExp(`^\\s*name:\\s*"${escapedName}"\\s*$`, "m"), "Cordis YAML must quote the scoped package identity");
assert.doesNotMatch(patch, new RegExp(`^\\s*name:\\s*${escapedName}\\s*$`, "m"), "Cordis YAML contains an unsafe unquoted scoped identity");
assert.match(client, new RegExp(`__ModuleLoader__\\.load\\(\\{\\s*id:\\s*"${escapedName}"`, "s"), "browser loader identity must match package name");
assert.match(client, new RegExp(`tag\\.dataset\\.plugin\\s*=\\s*"${escapedName}"`), "client style ownership identity must match package name");
assert.match(readme, new RegExp(`<!--\\s*stable-version:\\s*${pkg.version.replaceAll(".", "\\.")}\\s*-->`), "README stable-version marker must match package version");
assert.ok(readme.includes("https://github.com/iBobbyTS/dsh-usage-stats.git"), "README must point to this fork installation source");

console.log(`release metadata ok: ${pkg.name}@${pkg.version}`);
