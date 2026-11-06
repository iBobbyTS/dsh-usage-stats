import { readFile, writeFile } from "node:fs/promises";
import { SEMVER } from "./release-metadata.mjs";
const version = process.argv[2];

if (typeof version !== "string" || !SEMVER.test(version)) {
	console.error("usage: pnpm release:sync <semver>");
	process.exitCode = 1;
} else {
	const readJson = async (path) => JSON.parse(await readFile(path, "utf8"));
	const [pkg, readme] = await Promise.all([
		readJson("package.json"),
		readFile("README.md", "utf8")
	]);
	const previousVersion = pkg.version;
	const marker = `<!-- stable-version: ${previousVersion} -->`;
	if (!readme.includes(marker)) throw new Error(`README stable-version marker does not match package ${previousVersion}`);
	pkg.version = version;
	const nextReadme = readme
		.replace(marker, `<!-- stable-version: ${version} -->`)
		.replaceAll(`${pkg.name}@${previousVersion}`, `${pkg.name}@${version}`);
	await Promise.all([
		writeFile("package.json", `${JSON.stringify(pkg, null, 2)}\n`, "utf8"),
		writeFile("README.md", nextReadme, "utf8")
	]);
	console.log(`synchronized package and README version references to ${version}`);
}
