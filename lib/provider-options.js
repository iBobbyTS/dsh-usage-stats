import { failureDetails } from "./account-types.js";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { validateAccountConfig } from "./accounts.js";
// src/provider-options.ts
/**
* User-selected monitoring backend and compact display metric per DSH route.
*
* No credentials are stored here. credentialRef is an environment/credential
* reference name, never a raw API token. Account snapshots remain host-only.
*/
const MONITOR_ADAPTERS = Object.freeze([
	"deepseek-balance",
	"openrouter-balance",
	"moonshot-balance",
	"zai-balance",
	"general",
	"new-api",
	"sub2api",
	"sub2api-auth",
	"opencode-go",
	"commandcode-goat",
	"zai-token-plan",
	"kimi-token-plan",
	"minimax-token-plan",
	"ollama",
	"codearts-credits"
]);
const WINDOW_KINDS = Object.freeze([
	"session",
	"daily",
	"weekly",
	"monthly",
	"quota",
	"mcp"
]);
const METRICS = /* @__PURE__ */ new Set([
	"auto",
	"balance",
	...WINDOW_KINDS.map((kind) => "window:" + kind)
]);
const ADAPTER_SET = new Set(MONITOR_ADAPTERS);
const ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,255}$/;
const REF_PATTERN = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/;
function validateProviderOptionId(providerId) {
	if (typeof providerId !== "string" || !ID_PATTERN.test(providerId) || [
		"__proto__",
		"prototype",
		"constructor"
	].includes(providerId)) throw new Error("invalid provider id");
	return providerId;
}
function validateProviderOption(raw) {
	const value = raw;
	if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("provider options must be an object");
	const adapter = value.adapter === null || value.adapter === void 0 || value.adapter === "auto" ? null : value.adapter;
	if (adapter !== null && !ADAPTER_SET.has(adapter)) throw new Error("unsupported monitor adapter");
	const displayMetric = value.displayMetric ?? "auto";
	if (!METRICS.has(displayMetric)) throw new Error("unsupported display metric");
	const usageBaseURL = value.usageBaseURL === null || value.usageBaseURL === void 0 || value.usageBaseURL === "" ? null : value.usageBaseURL;
	if (usageBaseURL !== null) {
		if (typeof usageBaseURL !== "string" || usageBaseURL.length > 2048) throw new Error("invalid usage URL");
		let url;
		try {
			url = new URL(usageBaseURL);
		} catch {
			throw new Error("invalid usage URL");
		}
		if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) throw new Error("usage URL must be HTTPS without credentials, query, or fragment");
	}
	const credentialRef = value.credentialRef === null || value.credentialRef === void 0 || value.credentialRef === "" ? null : value.credentialRef;
	if (credentialRef !== null && (typeof credentialRef !== "string" || !REF_PATTERN.test(credentialRef))) throw new Error("credential reference must name a DSH credential/env variable");
	if ((usageBaseURL !== null || credentialRef !== null) && adapter === null) throw new Error("select a monitor adapter before overriding its endpoint or credential");
	return {
		adapter,
		displayMetric,
		usageBaseURL,
		credentialRef
	};
}
function validateProviderOptions(raw) {
	const value = raw;
	if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid options document");
	const keys = Object.keys(value);
	if (keys.length > 256) throw new Error("too many provider options");
	const result = Object.create(null);
	for (const key of keys) result[validateProviderOptionId(key)] = validateProviderOption(value[key]);
	return result;
}
function combineMonitorConfig(baseMonitors, options) {
	const monitors = Object.assign(Object.create(null), baseMonitors);
	for (const [providerId, option] of Object.entries(options)) {
		if (option.adapter === null) continue;
		monitors[providerId] = {
			...baseMonitors[providerId] ?? {},
			adapter: option.adapter,
			...option.usageBaseURL === null ? {} : { usageBaseURL: option.usageBaseURL },
			...option.credentialRef === null ? {} : { credentialRef: option.credentialRef }
		};
	}
	return validateAccountConfig({ monitors }).monitors;
}
function providerOptionsPath() {
	return join(process.env.DSH_HOME ?? join(homedir(), ".dsh"), "storages", "usage-stats-provider-options.json");
}
async function loadProviderOptions(path = providerOptionsPath()) {
	let content;
	try {
		content = await readFile(path, "utf8");
	} catch (error) {
		if (failureDetails(error).code === "ENOENT") return Object.create(null);
		throw error;
	}
	if (content.length > 131072) throw new Error("provider options file is too large");
	return validateProviderOptions(JSON.parse(content));
}
async function saveProviderOptions(options, path = providerOptionsPath()) {
	const normalized = validateProviderOptions(options);
	await mkdir(dirname(path), { recursive: true });
	const temp = path + "." + process.pid + "." + Math.random().toString(36).slice(2) + ".tmp";
	try {
		await writeFile(temp, JSON.stringify(normalized, null, 2) + "\n", {
			mode: 384,
			flag: "wx"
		});
		await rename(temp, path);
	} catch (error) {
		await unlink(temp).catch(() => {});
		throw error;
	}
}
export { MONITOR_ADAPTERS, WINDOW_KINDS, combineMonitorConfig, loadProviderOptions, providerOptionsPath, saveProviderOptions, validateProviderOption, validateProviderOptionId, validateProviderOptions };

//# sourceMappingURL=provider-options.js.map