import { failureDetails } from "./account-types.js";
import { resolveProviderIdentity } from "./provider-identity.js";
import { isPrivateAddress, isPrivateAddress as isPrivateAddress$1, isPrivateHostname } from "./network.js";
import { isIP } from "node:net";
import { queryBalance } from "./balance.js";
import { quotaAccountSnapshot } from "./quota.js";
import { queryArkCodingPlan, validateArkCLIConfig } from "./ark-coding-plan.js";
import { collectSubscription, isCommandCodeVersion, zaiRegionOf } from "./subscriptions.js";
import { lookup } from "node:dns/promises";
import { request } from "node:http";
import { request as request$1 } from "node:https";
// src/accounts.ts
/**
* Unified provider-account monitoring.
*
* Adapters normalize monetary balances and subscription/token-plan windows to
* one discriminated account snapshot. Configuration is declarative: secrets
* are credential references, request paths are relative, and response fields
* are extracted with JSON Pointer rather than executable JavaScript.
*
* @module dsh-usage-stats/accounts
*/
const DEFAULT_TIMEOUT_MS = 15e3;
const DEFAULT_REFRESH_MS = 3e5;
const MAX_REFRESH_INTERVAL_MS = 864e5;
const DEFAULT_REFRESH_CONFIG = Object.freeze({
	enabled: true,
	activeMs: 6e4,
	detailMs: 12e4,
	backgroundMs: 9e5
});
const DEFAULT_REFRESH_POLICY = Object.freeze({
	activeMs: DEFAULT_REFRESH_CONFIG.activeMs,
	detailMs: DEFAULT_REFRESH_CONFIG.detailMs,
	backgroundMs: DEFAULT_REFRESH_CONFIG.backgroundMs,
	rateLimitBaseMs: 3e5,
	rateLimitMaxMs: 36e5
});
const PROVENANCE_KINDS = /* @__PURE__ */ new Set([
	"official",
	"provider",
	"configured",
	"experimental",
	"unknown"
]);
const OFFICIAL_ADAPTERS = /* @__PURE__ */ new Set([
	"deepseek-balance",
	"deepseek-account",
	"openrouter-balance",
	"moonshot-balance",
	"zai-balance",
	"opencode-go",
	"commandcode-goat",
	"zai-token-plan",
	"kimi-token-plan",
	"minimax-token-plan",
	"ollama",
	"codearts-credits"
]);
const PROVIDER_ADAPTERS = /* @__PURE__ */ new Set([
	"new-api",
	"sub2api",
	"sub2api-auth"
]);
const MAX_RESPONSE_BYTES = 1048576;
const OPENROUTER_MANAGEMENT_REF = "OPENROUTER_MANAGEMENT_KEY";
/**
* The credential the Command Code provider plugin publishes by default. The
* subscription adapter states the same name in `REFS.commandCodeApiKey`; it is
* repeated here because the route registry path (above) reaches a Command Code
* route without any connection facts to read it from.
*/
const COMMAND_CODE_API_KEY_REF = "COMMANDCODE_API_KEY";
/**
* Real Sub2API panels expose a read-only public settings route used to detect
* the panel (auto-selecting the `sub2api-auth` adapter) and a balance route the
* provider's own inference API key can query — the same pattern as CC Switch's
* General usage template (GET {baseUrl}/user/balance with a Bearer api key).
*/
const SUB2API_BALANCE_PATH = "/user/balance";
const SUB2API_USAGE_STATS_PATH = "/api/v1/usage/stats?period=today";
const SUB2API_PUBLIC_SETTINGS_PATH = "/api/v1/settings/public";
const ACCOUNT_STATUSES = /* @__PURE__ */ new Set([
	"ok",
	"signed-out",
	"not-configured",
	"unauthorized",
	"rate-limited",
	"unavailable",
	"invalid-response",
	"blocked",
	"unsupported"
]);
const SAFE_REASON_CODES = /* @__PURE__ */ new Set([
	"dns-resolution-failed",
	"timeout",
	"rate-limited",
	"unauthorized",
	"upstream-invalid-json",
	"upstream-not-json",
	"upstream-too-large",
	"upstream-invalid-response",
	"blocked-network",
	"all-addresses-unreachable",
	"no-validated-address",
	"sub2api-balance-shape-unrecognized",
	"commandcode-billing-shape-unrecognized",
	"ark-cli-not-configured",
	"ark-cli-not-found",
	"ark-cli-native-executable-required",
	"ark-cli-no-subscription",
	"ark-cli-query-failed",
	"ark-cli-response-unrecognized",
	"unknown"
]);
const HEALTH_ATTEMPTED = Symbol("account-health-attempted");
const HEALTH_SUCCEEDED = Symbol("account-health-succeeded");
const ADAPTERS = /* @__PURE__ */ new Set([
	"deepseek-balance",
	"deepseek-account",
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
	"ark-coding-plan-cli",
	"codearts-credits",
	"declarative"
]);
const SENSITIVE_HEADERS = /* @__PURE__ */ new Set([
	"authorization",
	"api-key",
	"cookie",
	"host",
	"proxy-authorization",
	"proxy-authenticate",
	"set-cookie",
	"transfer-encoding",
	"connection",
	"upgrade",
	"x-api-key"
]);
function nonEmptyString(value) {
	return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}
function numberOrNull(value) {
	if (typeof value === "number" && Number.isFinite(value)) return value;
	if (typeof value === "string" && value.trim() !== "") {
		const parsed = Number(value);
		if (Number.isFinite(parsed)) return parsed;
	}
	return null;
}
function booleanOrNull(value) {
	if (typeof value === "boolean") return value;
	if (value === 1 || value === "1" || value === "true") return true;
	if (value === 0 || value === "0" || value === "false") return false;
	return null;
}
function round1(value) {
	return Math.round(value * 10) / 10;
}
/** Normalize how trustworthy an account endpoint binding is. */
function accountProvenance(spec) {
	if (PROVENANCE_KINDS.has(spec?.provenanceHint)) return spec.provenanceHint;
	const adapter = nonEmptyString(spec?.adapter);
	if (adapter === null) return "unknown";
	if (adapter === "ark-coding-plan-cli") return "experimental";
	if (adapter === "declarative" || adapter === "general") return "configured";
	if (OFFICIAL_ADAPTERS.has(adapter)) return "official";
	if (PROVIDER_ADAPTERS.has(adapter)) return "provider";
	return "unknown";
}
/** Derive health age from the last successful sample without mutating cache state. */
function withHealthAge(snapshot, now = Date.now()) {
	if (snapshot === null || snapshot === void 0 || typeof snapshot !== "object") return snapshot;
	const lastSuccessAt = typeof snapshot.lastSuccessAt === "number" && Number.isFinite(snapshot.lastSuccessAt) ? snapshot.lastSuccessAt : null;
	return {
		...snapshot,
		ageMs: lastSuccessAt === null ? null : Math.max(0, now - lastSuccessAt)
	};
}
/** Pure central refresh policy; scheduling and I/O stay outside this function. */
function refreshPolicy(state, now = Date.now(), overrides = {}) {
	const intervals = {
		...DEFAULT_REFRESH_POLICY,
		...overrides
	};
	const activity = state?.activity === "active" || state?.activity === "detail" ? state.activity : "background";
	const lastAttemptAt = typeof state?.lastAttemptAt === "number" && Number.isFinite(state.lastAttemptAt) ? state.lastAttemptAt : null;
	const priority = activity === "active" ? 3 : activity === "detail" ? 2 : 1;
	if (lastAttemptAt === null) return {
		activity,
		priority,
		delayMs: 0,
		nextRefreshAt: now
	};
	const normalDelayMs = activity === "active" ? intervals.activeMs : activity === "detail" ? intervals.detailMs : intervals.backgroundMs;
	let delayMs = normalDelayMs;
	if ((Number(state?.rateLimitFailures) || 0) > 0) {
		const failures = Math.max(1, Math.floor(Number(state.rateLimitFailures) || 1));
		const backoffDelayMs = Math.min(intervals.rateLimitMaxMs, intervals.rateLimitBaseMs * 2 ** Math.min(20, failures - 1));
		delayMs = Math.max(normalDelayMs, backoffDelayMs);
	}
	return {
		activity,
		priority,
		delayMs,
		nextRefreshAt: lastAttemptAt + delayMs
	};
}
function toIso(value) {
	if (value === null || value === void 0 || value === "") return null;
	if (typeof value === "number" && Number.isFinite(value)) {
		const date = new Date(value < 2e10 ? value * 1e3 : value);
		return Number.isNaN(date.getTime()) ? null : date.toISOString();
	}
	const date = new Date(String(value));
	return Number.isNaN(date.getTime()) ? null : date.toISOString();
}
function statusError(status, message, httpStatus, safeReason) {
	const error = new Error(message);
	error.providerStatus = status;
	if (httpStatus !== void 0) error.httpStatus = httpStatus;
	if (safeReason !== void 0) failureDetails(error).safeReason = safeReason;
	return error;
}
function statusOf(error) {
	if (ACCOUNT_STATUSES.has(failureDetails(error).providerStatus)) return failureDetails(error).providerStatus;
	if (failureDetails(error).name === "TimeoutError" || failureDetails(error).name === "AbortError") return "unavailable";
	return "unavailable";
}
function safeReasonOf(error) {
	const reason = nonEmptyString(failureDetails(error).safeReason);
	if (reason !== null && SAFE_REASON_CODES.has(reason)) return reason;
	const status = statusOf(error);
	if (failureDetails(error).name === "TimeoutError" || failureDetails(error).name === "AbortError") return "timeout";
	if (status === "rate-limited") return "rate-limited";
	if (status === "unauthorized") return "unauthorized";
	if (status === "blocked") return "blocked-network";
	if (status === "invalid-response") return "upstream-invalid-response";
	return status === "unavailable" ? "unknown" : null;
}
function providerReasonOf(reason, status) {
	const value = nonEmptyString(reason);
	if (value !== null && SAFE_REASON_CODES.has(value)) return value;
	if (status === "rate-limited") return "rate-limited";
	if (status === "unauthorized") return "unauthorized";
	if (status === "blocked") return "blocked-network";
	if (status === "invalid-response") return "upstream-invalid-response";
	if (status === "unavailable") return "unknown";
	return null;
}
function minimaxRouteRegionOf(spec) {
	const identity = [
		spec.id,
		spec.providerBaseURL,
		spec.baseURL,
		spec.apiKeyRef
	].map((value) => String(value ?? "").toLowerCase());
	if (identity.some((value) => value.includes("minimaxi.com") || /minimax[^\p{L}\p{N}]*cn|cn[^\p{L}\p{N}]*minimax/u.test(value))) return "cn";
	if (identity.some((value) => value.includes("minimax.io") || value === "minimax" || value === "minimax-global" || value === "minimax_api_key" || value === "minimax-global-api-key")) return "global";
}
/** Attach service-internal query facts without expanding the wire protocol. */
function annotateQuerySnapshot(snapshot, { attempted, succeeded }) {
	Object.defineProperties(snapshot, {
		[HEALTH_ATTEMPTED]: { value: attempted === true },
		[HEALTH_SUCCEEDED]: { value: succeeded === true }
	});
	return snapshot;
}
async function resolveCredential(credentials, ref) {
	if (nonEmptyString(ref) === null || credentials === null || credentials === void 0 || typeof credentials.resolve !== "function") return "";
	try {
		return nonEmptyString((await credentials.resolve(ref))?.value) ?? "";
	} catch {
		return "";
	}
}
function responseStatus(status) {
	if (status === 401 || status === 403) return "unauthorized";
	if (status === 429) return "rate-limited";
	if (status === 404 || status === 405) return "unsupported";
	return status >= 500 ? "unavailable" : "invalid-response";
}
async function parseJsonResponse(response, maxBytes = MAX_RESPONSE_BYTES) {
	const declared = numberOrNull(response.headers?.get?.("content-length"));
	if (declared !== null && declared > maxBytes) throw statusError("invalid-response", "upstream response exceeds the size limit", void 0, "upstream-too-large");
	const contentType = response.headers?.get?.("content-type");
	if (typeof contentType === "string" && contentType !== "" && !/\bjson\b/i.test(contentType)) throw statusError("invalid-response", "upstream did not return JSON", void 0, "upstream-not-json");
	if (typeof response.arrayBuffer === "function") {
		const bytes = new Uint8Array(await response.arrayBuffer());
		if (bytes.byteLength > maxBytes) throw statusError("invalid-response", "upstream response exceeds the size limit", void 0, "upstream-too-large");
		try {
			return JSON.parse(new TextDecoder().decode(bytes));
		} catch {
			throw statusError("invalid-response", "upstream returned invalid JSON", void 0, "upstream-invalid-json");
		}
	}
	try {
		return await response.json();
	} catch {
		throw statusError("invalid-response", "upstream returned invalid JSON", void 0, "upstream-invalid-json");
	}
}
async function requestJson(url, init, deps = {}) {
	const response = await (deps.fetch ?? fetch)(url, {
		...init,
		redirect: "manual",
		signal: AbortSignal.timeout(deps.timeoutMs ?? DEFAULT_TIMEOUT_MS)
	});
	if (!response.ok) throw statusError(responseStatus(response.status), `upstream returned HTTP ${response.status}`, response.status);
	return parseJsonResponse(response, deps.maxResponseBytes ?? MAX_RESPONSE_BYTES);
}
function schemeOfAdapter(adapter) {
	return adapter.endsWith("-balance") ? adapter.slice(0, -8) : null;
}
/**
* Subscription id per subscription-mode adapter. Every adapter that reaches the
* subscription branch is listed here, so the lookup states the mapping once
* instead of nesting one ternary per provider.
*/
const SUBSCRIPTION_IDS = Object.freeze({
	"opencode-go": "opencode-go",
	"commandcode-goat": "commandcode-goat",
	"zai-token-plan": "zai",
	"kimi-token-plan": "kimi",
	"minimax-token-plan": "minimax",
	ollama: "ollama"
});
/**
* Adapters whose vendor endpoint is intrinsic to the adapter: they never read
* the provider's configured baseURL, so an explicit credential reference
* alone still leaves them a complete, borrow-free query target.
*/
const INTRINSIC_ENDPOINT_ADAPTERS = new Set(Object.keys(SUBSCRIPTION_IDS));
function adapterMode(adapter, monitor) {
	if (adapter === "ark-coding-plan-cli") return "subscription";
	if (adapter === "declarative") return monitor.mode;
	if ([
		"opencode-go",
		"commandcode-goat",
		"zai-token-plan",
		"kimi-token-plan",
		"minimax-token-plan",
		"ollama",
		"codearts-credits"
	].includes(adapter)) return "subscription";
	return "balance";
}
/**
* Some Host provider registries expose only a canonical route id and display
* name. Keep the built-in credential fallback narrow: a custom provider must
* never inherit a credential merely because it selected the same adapter.
*/
function defaultCredentialRef(provider, adapter) {
	if (adapter === "zai-token-plan" && (provider?.id === "zai" || provider?.id === "zai-coding-cn")) return "ZAI_API_KEY";
	if (adapter === "opencode-go" && provider?.id === "opencode-go") return "OPENCODE_API_KEY";
}
function assertRelativePath(path, label) {
	if (typeof path !== "string" || !path.startsWith("/") || path.startsWith("//")) throw new Error(`${label} must be an absolute-path relative path beginning with /`);
	try {
		if (new URL(path, "https://usage.invalid").origin !== "https://usage.invalid") throw new Error("origin changed");
	} catch {
		throw new Error(`${label} must be a relative path, not a URL`);
	}
}
function validatePointer(pointer, label) {
	if (pointer === void 0 || pointer === null) return;
	const value = typeof pointer === "object" && pointer !== null ? pointer.pointer : pointer;
	if (typeof value !== "string" || value !== "" && !value.startsWith("/")) throw new Error(`${label} must be a JSON Pointer`);
}
function validateWarning(value, label) {
	if (value === void 0) return;
	if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
	for (const field of ["warnBelow", "criticalBelow"]) if (value[field] !== void 0 && numberOrNull(value[field]) === null) throw new Error(`${label}.${field} must be numeric`);
	const warn = numberOrNull(value.warnBelow);
	const critical = numberOrNull(value.criticalBelow);
	if (warn !== null && critical !== null && critical > warn) throw new Error(`${label}.criticalBelow must not exceed warnBelow`);
}
function validateDeclarative(monitor, label) {
	if (monitor.mode !== "balance" && monitor.mode !== "subscription") throw new Error(`${label}.mode must be balance or subscription`);
	if (monitor.request === null || typeof monitor.request !== "object" || Array.isArray(monitor.request)) throw new Error(`${label}.request must be an object`);
	assertRelativePath(monitor.request.path, `${label}.request.path`);
	if (monitor.request.method !== void 0 && monitor.request.method !== "GET") throw new Error(`${label}.request.method must be GET`);
	const auth = monitor.request.auth;
	if (auth !== void 0 && (auth === null || typeof auth !== "object" || Array.isArray(auth))) throw new Error(`${label}.request.auth must be an object`);
	const authType = auth?.type;
	if (authType !== void 0 && ![
		"bearer",
		"raw",
		"x-api-key",
		"query"
	].includes(authType)) throw new Error(`${label}.request.auth.type is unsupported`);
	if (authType === "query") {
		if (Object.keys(auth).some((key) => ![
			"type",
			"param",
			"credentialRef"
		].includes(key))) throw new Error(`${label}.request.auth contains unsupported fields`);
		if (typeof auth.param !== "string" || !/^[A-Za-z_][A-Za-z0-9_.-]{0,63}$/.test(auth.param)) throw new Error(`${label}.request.auth.param must be a 1–64 character parameter name beginning with a letter or underscore`);
		if (auth.credentialRef !== void 0 && nonEmptyString(auth.credentialRef) === null) throw new Error(`${label}.request.auth.credentialRef must be a non-empty string`);
		const path = new URL(monitor.request.path, "https://usage.invalid");
		if (monitor.request.path.includes("#")) throw new Error(`${label}.request.path must not contain a fragment`);
		if (path.searchParams.has(auth.param)) throw new Error(`${label}.request.path must not contain the authentication parameter`);
		if (monitor.usageBaseURL !== void 0) {
			if (new URL(monitor.usageBaseURL).search !== "" || monitor.usageBaseURL.includes("#")) throw new Error(`${label}.usageBaseURL must not contain a query or fragment`);
		}
	}
	for (const name of Object.keys(monitor.request.headers ?? {})) if (SENSITIVE_HEADERS.has(name.toLowerCase())) throw new Error(`${label}.request.headers cannot override ${name}`);
	if (monitor.extract === null || typeof monitor.extract !== "object" || Array.isArray(monitor.extract)) throw new Error(`${label}.extract must be an object`);
	for (const field of [
		"root",
		"valid",
		"invalidMessage",
		"plan",
		"remaining",
		"used",
		"total",
		"currency",
		"unlimited",
		"expiresAt",
		"items",
		"kind",
		"usedPercent",
		"remainingPercent",
		"resetsAt"
	]) validatePointer(monitor.extract[field], `${label}.extract.${field}`);
	if (monitor.mode === "balance" && monitor.extract.remaining === void 0 && monitor.extract.total === void 0) throw new Error(`${label}.extract requires remaining or total`);
	if (monitor.mode === "subscription" && monitor.extract.items === void 0) throw new Error(`${label}.extract.items is required`);
	if (monitor.extract.divisor !== void 0 && (numberOrNull(monitor.extract.divisor) === null || Number(monitor.extract.divisor) === 0)) throw new Error(`${label}.extract.divisor must be a non-zero number`);
}
function validateRefreshInterval(value, label, fallback) {
	if (value === void 0) return fallback;
	if (typeof value !== "number" || !Number.isFinite(value) || !Number.isInteger(value) || value < 6e4 || value > MAX_REFRESH_INTERVAL_MS) throw new Error(`${label} must be an integer from 60000 to ${MAX_REFRESH_INTERVAL_MS} ms`);
	return value;
}
function validateRefreshConfig(raw, disableBackgroundRefresh) {
	if (raw === void 0) raw = {};
	if (raw === null || typeof raw !== "object" || Array.isArray(raw)) throw new Error("refresh must be an object");
	if (disableBackgroundRefresh !== void 0 && typeof disableBackgroundRefresh !== "boolean") throw new Error("disableBackgroundRefresh must be a boolean");
	if (raw.enabled !== void 0 && typeof raw.enabled !== "boolean") throw new Error("refresh.enabled must be a boolean");
	return {
		enabled: raw.enabled ?? (disableBackgroundRefresh === true ? false : DEFAULT_REFRESH_CONFIG.enabled),
		activeMs: validateRefreshInterval(raw.activeMs, "refresh.activeMs", DEFAULT_REFRESH_CONFIG.activeMs),
		detailMs: validateRefreshInterval(raw.detailMs, "refresh.detailMs", DEFAULT_REFRESH_CONFIG.detailMs),
		backgroundMs: validateRefreshInterval(raw.backgroundMs, "refresh.backgroundMs", DEFAULT_REFRESH_CONFIG.backgroundMs)
	};
}
/** Validate and freeze the non-secret account-monitor configuration shape. */
function validateAccountConfig(raw = {}) {
	if (raw === null || typeof raw !== "object" || Array.isArray(raw)) throw new Error("account config must be an object");
	const refresh = validateRefreshConfig(raw.refresh, raw.disableBackgroundRefresh);
	const monitors = raw.monitors ?? {};
	if (monitors === null || typeof monitors !== "object" || Array.isArray(monitors)) throw new Error("monitors must be an object keyed by provider id");
	const normalized = {};
	for (const [key, value] of Object.entries(monitors)) {
		const label = `monitors.${key}`;
		if (nonEmptyString(key) === null || value === null || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
		const providerId = nonEmptyString(value.providerId) ?? key;
		const adapter = nonEmptyString(value.adapter);
		if (adapter === null || !ADAPTERS.has(adapter)) throw new Error(`${label}.adapter is unsupported`);
		if (value.usageBaseURL !== void 0) {
			let url;
			try {
				url = new URL(value.usageBaseURL);
			} catch {
				throw new Error(`${label}.usageBaseURL must be a valid URL`);
			}
			if (url.username !== "" || url.password !== "") throw new Error(`${label}.usageBaseURL must not contain credentials`);
			if (url.protocol !== "https:" && value.allowInsecure !== true) throw new Error(`${label}.usageBaseURL must use HTTPS unless allowInsecure is true`);
		}
		validateWarning(value.warning, `${label}.warning`);
		if (value.commandCodeVersion !== void 0 && !isCommandCodeVersion(value.commandCodeVersion)) throw new Error(`${label}.commandCodeVersion must be a non-empty version string such as 1.72.1`);
		if (adapter === "declarative") validateDeclarative(value, label);
		if (adapter === "ark-coding-plan-cli") validateArkCLIConfig(value, label);
		normalized[providerId] = {
			...value,
			providerId,
			adapter
		};
	}
	return {
		monitors: normalized,
		refresh
	};
}
/** Bind one configured Harness provider to its explicit or built-in adapter. */
function resolveAccountSpec(provider, config = { monitors: {} }) {
	const monitor = config.monitors?.[provider.id] ?? {};
	const nativeAdapter = resolveProviderIdentity(provider, config).accountAdapter;
	const quotaBinding = monitor.adapter === void 0 && nativeAdapter === null ? provider.quotaBinding : void 0;
	const adapter = quotaBinding ? "quota-source" : nativeAdapter;
	const mode = quotaBinding ? "subscription" : adapter === null ? null : adapterMode(adapter, monitor);
	const defaultApiKeyRef = defaultCredentialRef(provider, adapter);
	const explicitUsageURL = nonEmptyString(monitor.usageBaseURL);
	const explicitCredentialRef = monitor.credentialRef == null ? null : nonEmptyString(monitor.credentialRef);
	const overridesPaired = explicitUsageURL !== null || explicitCredentialRef !== null;
	const fallbackApiKeyRef = overridesPaired ? void 0 : (adapter === "openrouter-balance" ? OPENROUTER_MANAGEMENT_REF : provider.apiKeyEnv ?? (adapter === "commandcode-goat" ? COMMAND_CODE_API_KEY_REF : void 0)) ?? defaultApiKeyRef ?? (adapter === "minimax-token-plan" && ["minimax", "minimax-cn"].includes(provider.id) && nonEmptyString(provider.baseURL) === null && explicitUsageURL === null ? provider.id === "minimax-cn" ? "MINIMAX_CN_API_KEY" : "MINIMAX_API_KEY" : void 0);
	const apiKeyRef = (adapter === "declarative" ? monitor.request?.auth?.credentialRef : void 0) ?? monitor.credentialRef ?? fallbackApiKeyRef;
	const resolvedBaseURL = monitor.usageBaseURL ?? (provider.ownedBaseURL === true && overridesPaired ? void 0 : provider.baseURL);
	return {
		id: provider.id,
		displayName: provider.displayName ?? provider.id,
		adapter,
		mode,
		quotaBinding,
		apiKeyRef: apiKeyRef ?? void 0,
		useDefaultZaiCredential: adapter === "zai-token-plan" && defaultApiKeyRef !== void 0 && monitor.credentialRef == null && provider.apiKeyEnv == null && !overridesPaired,
		useDefaultOpenCodeCredential: adapter === "opencode-go" && provider.id === "opencode-go" && monitor.credentialRef == null && provider.apiKeyEnv == null && !overridesPaired,
		credentialRecord: overridesPaired ? void 0 : provider.credentialRecord,
		overrideIncomplete: overridesPaired && (explicitCredentialRef === null || explicitUsageURL === null && resolvedBaseURL === void 0 && !INTRINSIC_ENDPOINT_ADAPTERS.has(adapter)),
		baseURL: resolvedBaseURL,
		providerBaseURL: provider.baseURL,
		monitor,
		configKey: JSON.stringify({
			adapter,
			mode,
			provider,
			monitor
		})
	};
}
function zaiRegionHintOf(spec) {
	const explicit = nonEmptyString(spec.monitor?.region);
	if (explicit !== null) return explicit;
	const routeId = String(spec.id ?? "").trim().toLowerCase();
	const urls = [
		spec.monitor?.usageBaseURL,
		spec.providerBaseURL,
		spec.baseURL
	].map((value) => nonEmptyString(value)?.toLowerCase() ?? "").filter(Boolean);
	if (urls.some((value) => value.includes("bigmodel.cn"))) return "bigmodel-cn";
	if (urls.some((value) => value.includes("api.z.ai"))) return "global";
	if (routeId === "zai-coding-cn") return "bigmodel-cn";
}
/** Read the provider's own models-page API key from its scoped record. */
async function readCredentialRecord(credentials, key) {
	if (nonEmptyString(key) === null || credentials === null || credentials === void 0 || typeof credentials.readRecord !== "function") return null;
	try {
		const record = await credentials.readRecord(key);
		if (record?.kind === "api-key" && nonEmptyString(record.key) !== null) return record.key;
	} catch {}
	return null;
}
/** Resolve default Z.ai aliases locally, before either UI discovery or a query. */
async function resolveAccountCredential(spec, credentials) {
	if (spec.useDefaultOpenCodeCredential) {
		for (const ref of ["OPENCODE_API_KEY", "OPENCODE_GO_API_KEY"]) {
			const value = await resolveCredential(credentials, ref);
			if (value !== "") return {
				ref,
				value
			};
		}
		return {
			ref: "OPENCODE_API_KEY",
			value: ""
		};
	}
	if (!spec.useDefaultZaiCredential) {
		const record = await readCredentialRecord(credentials, spec.credentialRecord);
		if (record !== null) return {
			ref: spec.credentialRecord,
			value: record
		};
		return {
			ref: spec.apiKeyRef,
			value: await resolveCredential(credentials, spec.apiKeyRef)
		};
	}
	const configuredRegion = await resolveCredential(credentials, "ZAI_API_REGION");
	const region = zaiRegionOf(nonEmptyString(spec.monitor?.region) ?? configuredRegion, zaiRegionHintOf(spec));
	const refs = spec.id === "zai-coding-cn" && region === "bigmodel-cn" ? ["ZAI_CODING_CN_API_KEY", "ZAI_API_KEY"] : ["ZAI_API_KEY"];
	for (const ref of refs) {
		const value = await resolveCredential(credentials, ref);
		if (value !== "") return {
			ref,
			value,
			region
		};
	}
	return {
		ref: refs[0],
		value: "",
		region
	};
}
function decodePointerToken(token) {
	return token.replace(/~1/g, "/").replace(/~0/g, "~");
}
/** RFC 6901 JSON Pointer lookup; missing paths return undefined. */
function jsonPointer(value, pointer) {
	if (pointer === "" || pointer === void 0 || pointer === null) return value;
	if (typeof pointer !== "string" || !pointer.startsWith("/")) return void 0;
	let current = value;
	for (const raw of pointer.slice(1).split("/")) {
		const key = decodePointerToken(raw);
		if (current === null || current === void 0 || typeof current !== "object" || !Object.hasOwn(current, key)) return void 0;
		current = current[key];
	}
	return current;
}
function mapped(root, mapping) {
	if (mapping === void 0 || mapping === null) return void 0;
	if (typeof mapping === "string") return jsonPointer(root, mapping);
	if (typeof mapping === "object" && typeof mapping.pointer === "string") {
		const value = jsonPointer(root, mapping.pointer);
		const divisor = numberOrNull(mapping.divisor);
		return divisor === null ? value : numberOrNull(value) === null ? void 0 : Number(value) / divisor;
	}
}
/** Return the untransformed value for a mapping so callers can distinguish missing from malformed data. */
function mappedSource(root, mapping) {
	if (mapping === void 0 || mapping === null) return void 0;
	if (typeof mapping === "string") return jsonPointer(root, mapping);
	if (typeof mapping === "object" && typeof mapping.pointer === "string") return jsonPointer(root, mapping.pointer);
}
/**
* RFC 2544 benchmarking range commonly used by proxy fake-IP DNS.
*
* This range remains non-public for normal policy decisions. It is only
* accepted later as a proxy-synthetic DNS answer for HTTPS hostnames.
*/
function isBenchmarkFakeIpAddress(address) {
	const value = String(address ?? "").trim().replace(/^\[|\]$/g, "");
	if (isIP(value) !== 4) return false;
	const [a, b] = value.split(".").map(Number);
	return a === 198 && (b === 18 || b === 19);
}
/**
* A benchmarking-range address may represent a proxy/TUN synthetic mapping
* only when it came from resolving an HTTPS hostname.
*
* Literal https://198.18.x.x targets never enter this exception because the
* original URL hostname is itself an IP literal.
*/
function isHttpsProxySyntheticAddress(url, address) {
	const hostname = url.hostname.replace(/^\[|\]$/g, "");
	return url.protocol === "https:" && isIP(hostname) === 0 && isBenchmarkFakeIpAddress(address);
}
/**
* Pick the connection address from validated DNS answers.
*
* Order of preference when private-network access is not explicitly enabled:
*   1. a genuinely public answer;
*   2. an IPv4 benchmarking-range (198.18.0.0/15) answer, only for an HTTPS
*      hostname resolved through DNS (a Clash/Mihomo-style fake-IP mapping);
*   3. otherwise no usable address (reject).
*
* With allowPrivateNetwork the first answer is returned unchanged. This is a
* pure helper exported for offline policy tests; it performs no I/O.
*/
function selectResolvedAddresses(url, rawAddresses, allowPrivateNetwork = false) {
	const addresses = (Array.isArray(rawAddresses) ? rawAddresses : [rawAddresses]).filter((entry) => typeof entry?.address === "string" && isIP(entry.address) !== 0).map((entry) => ({
		address: entry.address,
		family: entry.family ?? isIP(entry.address)
	}));
	if (addresses.length === 0) return [];
	if (allowPrivateNetwork) return addresses;
	const publicAddresses = addresses.filter((entry) => !isPrivateAddress$1(entry.address));
	if (publicAddresses.length > 0) return publicAddresses;
	return addresses.filter((entry) => isHttpsProxySyntheticAddress(url, entry.address));
}
/** Backward-compatible single-address policy helper used by existing tests/callers. */
function selectResolvedAddress(url, rawAddresses, allowPrivateNetwork = false) {
	return selectResolvedAddresses(url, rawAddresses, allowPrivateNetwork)[0] ?? null;
}
async function resolvePublicAddresses(url, spec, deps) {
	const hostname = url.hostname.replace(/^\[|\]$/g, "");
	if (isPrivateHostname(hostname) && spec.monitor.allowPrivateNetwork !== true) throw statusError("blocked", "account monitor private-network access requires allowPrivateNetwork");
	if (isIP(hostname) !== 0) return [{
		address: hostname,
		family: isIP(hostname)
	}];
	let addresses;
	try {
		addresses = await (deps.lookup ?? lookup)(hostname, {
			all: true,
			verbatim: true
		});
	} catch {
		throw statusError("unavailable", "account monitor hostname could not be resolved", void 0, "dns-resolution-failed");
	}
	if (!Array.isArray(addresses)) addresses = [addresses];
	if (addresses.length === 0) throw statusError("unavailable", "account monitor hostname resolved to no addresses", void 0, "dns-resolution-failed");
	const selected = selectResolvedAddresses(url, addresses, spec.monitor.allowPrivateNetwork === true);
	if (selected.length === 0) throw statusError("blocked", "account monitor hostname resolves only to blocked network addresses");
	return selected;
}
function crossOriginSensitive(spec) {
	return spec.monitor.usageBaseURL !== void 0 || spec.adapter === "general" || spec.adapter === "new-api" || spec.adapter === "sub2api-auth" || spec.adapter === "declarative" || schemeOfAdapter(spec.adapter ?? "") !== null;
}
async function assertTargetPolicy(rawUrl, spec, deps) {
	const url = new URL(rawUrl);
	if (url.username !== "" || url.password !== "") throw statusError("unsupported", "account monitor URL must not contain credentials");
	if (url.protocol !== "https:" && spec.monitor.allowInsecure !== true) throw statusError("blocked", "account monitor requires HTTPS");
	if (url.protocol !== "https:" && url.protocol !== "http:") throw statusError("unsupported", "account monitor protocol is unsupported");
	if (crossOriginSensitive(spec) && nonEmptyString(spec.providerBaseURL) !== null) {
		const providerOrigin = new URL(spec.providerBaseURL).origin;
		if (url.origin !== providerOrigin && spec.monitor.allowCrossOrigin !== true) throw statusError("blocked", "account monitor cross-origin access requires allowCrossOrigin");
	}
	return {
		url,
		addresses: await resolvePublicAddresses(url, spec, deps)
	};
}
function responseHeaders(headers) {
	return { get: (name) => {
		const value = headers[String(name).toLowerCase()];
		return Array.isArray(value) ? value.join(", ") : value === void 0 ? null : String(value);
	} };
}
const RETRYABLE_CONNECTION_CODES = /* @__PURE__ */ new Set([
	"ENETUNREACH",
	"EHOSTUNREACH",
	"EADDRNOTAVAIL",
	"ETIMEDOUT",
	"ECONNREFUSED",
	"ECONNRESET"
]);
function retryableConnectionError(error) {
	return RETRYABLE_CONNECTION_CODES.has(failureDetails(error).code);
}
function pinnedRequest(url, address, init, deps, signal) {
	return new Promise((resolve, reject) => {
		const request$2 = (url.protocol === "https:" ? request$1 : request)(url, {
			method: init?.method ?? "GET",
			headers: init?.headers,
			signal,
			family: address.family,
			autoSelectFamily: false,
			servername: isIP(url.hostname.replace(/^\[|\]$/g, "")) === 0 ? url.hostname : void 0,
			lookup: (_hostname, options, callback) => {
				process.nextTick(() => {
					if (options?.all) callback(null, [address]);
					else callback(null, address.address, address.family);
				});
			}
		}, (response) => {
			const chunks = [];
			let size = 0;
			response.on("data", (chunk) => {
				size += chunk.length;
				if (size > (deps.maxResponseBytes ?? MAX_RESPONSE_BYTES)) request$2.destroy(statusError("invalid-response", "upstream response exceeds the size limit", void 0, "upstream-too-large"));
				else chunks.push(chunk);
			});
			response.on("end", () => {
				const body = Buffer.concat(chunks);
				resolve({
					ok: response.statusCode >= 200 && response.statusCode < 300,
					status: response.statusCode,
					headers: responseHeaders(response.headers),
					arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength),
					json: async () => JSON.parse(body.toString("utf8")),
					text: async () => body.toString("utf8")
				});
			});
		});
		request$2.on("error", reject);
		request$2.on("socket", (socket) => {
			socket.on("error", (error) => request$2.emit("error", error));
		});
		request$2.end();
	});
}
/** HTTPS/HTTP transport that pins every attempted connection to an address already approved by the policy layer. */
async function pinnedFetch(rawUrl, init, spec, deps) {
	const target = await assertTargetPolicy(rawUrl, spec, deps);
	const signal = init?.signal ?? AbortSignal.timeout(deps.timeoutMs ?? DEFAULT_TIMEOUT_MS);
	const requestOne = deps.requestPinned ?? ((url, address, requestInit) => pinnedRequest(url, address, requestInit, deps, signal));
	let lastRetryable = null;
	for (const address of target.addresses) try {
		return await requestOne(target.url, address, init, signal);
	} catch (error) {
		if (!retryableConnectionError(error)) throw error;
		lastRetryable = error;
	}
	if (lastRetryable !== null) throw statusError("unavailable", "account monitor could not connect to any validated address", void 0, "all-addresses-unreachable");
	throw statusError("unavailable", "account monitor has no validated connection address", void 0, "no-validated-address");
}
function customURL(spec, credential) {
	const base = new URL(spec.baseURL);
	if (spec.monitor.request.auth?.type === "query" && (base.search !== "" || base.hash !== "")) throw statusError("unsupported", "query-auth base URL must not contain a query or fragment");
	const providerBase = nonEmptyString(spec.providerBaseURL) === null ? null : new URL(spec.providerBaseURL);
	if (base.protocol !== "https:" && spec.monitor.allowInsecure !== true) throw statusError("blocked", "custom monitor requires HTTPS");
	if (isPrivateHostname(base.hostname) && spec.monitor.allowPrivateNetwork !== true) throw statusError("blocked", "custom monitor private-network access requires allowPrivateNetwork");
	if (providerBase !== null && base.origin !== providerBase.origin && spec.monitor.allowCrossOrigin !== true) throw statusError("blocked", "custom monitor cross-origin access requires allowCrossOrigin");
	const url = new URL(spec.monitor.request.path, base);
	if (url.origin !== base.origin) throw statusError("unsupported", "custom monitor request must stay on its configured origin");
	if (spec.monitor.request.auth?.type === "query") url.searchParams.set(spec.monitor.request.auth.param, credential);
	return url.href;
}
function customHeaders(spec, credential) {
	const headers = { accept: "application/json" };
	for (const [name, value] of Object.entries(spec.monitor.request.headers ?? {})) if (!SENSITIVE_HEADERS.has(name.toLowerCase()) && typeof value === "string") headers[name] = value;
	const type = spec.monitor.request.auth?.type;
	if (credential !== "") {
		if (type === "bearer") headers.authorization = `Bearer ${credential}`;
		if (type === "raw") headers.authorization = credential;
		if (type === "x-api-key") headers["x-api-key"] = credential;
	}
	return headers;
}
function balanceAlert(balance, warning) {
	const remaining = numberOrNull(balance?.remaining);
	const warnBelow = numberOrNull(warning?.warnBelow);
	const criticalBelow = numberOrNull(warning?.criticalBelow);
	if (remaining !== null && (warnBelow !== null || criticalBelow !== null)) {
		if (criticalBelow !== null && remaining <= criticalBelow) return {
			level: "critical",
			metric: "balance",
			value: remaining,
			threshold: criticalBelow
		};
		if (warnBelow !== null && remaining <= warnBelow) return {
			level: "warning",
			metric: "balance",
			value: remaining,
			threshold: warnBelow
		};
		return {
			level: "normal",
			metric: "balance",
			value: remaining
		};
	}
	const total = numberOrNull(balance?.total);
	if (remaining !== null && total !== null && total > 0) {
		const value = round1(Math.max(0, Math.min(100, remaining / total * 100)));
		return {
			level: value <= 10 ? "critical" : value <= 30 ? "warning" : "normal",
			metric: "remaining-percent",
			value
		};
	}
	return {
		level: "unknown",
		metric: "balance",
		value: remaining
	};
}
function subscriptionAlert(windows) {
	const remaining = windows.filter((entry) => entry.kind !== "expired").map((entry) => numberOrNull(entry.remainingPercent)).filter((value) => value !== null);
	if (remaining.length === 0) return {
		level: "unknown",
		metric: "remaining-percent",
		value: null
	};
	const value = round1(Math.min(...remaining));
	return {
		level: value <= 10 ? "critical" : value <= 30 ? "warning" : "normal",
		metric: "remaining-percent",
		value
	};
}
function baseSnapshot(spec, status, now) {
	return {
		id: spec.id,
		displayName: spec.displayName,
		mode: spec.mode ?? "balance",
		adapter: spec.adapter,
		provenance: accountProvenance(spec),
		status,
		fetchedAt: now
	};
}
function unavailableSnapshot(spec, status, now, extra = {}) {
	const base = baseSnapshot(spec, status, now);
	if (base.mode === "subscription") return {
		...base,
		windows: [],
		alert: subscriptionAlert([]),
		...extra
	};
	return {
		...base,
		balance: null,
		alert: {
			level: "unknown",
			metric: "balance",
			value: null
		},
		...extra
	};
}
/**
* 惰性取宿主服务：deps 里既可直接放服务实例，也可放 `() => service`。
*
* ⚠️ 必须是惰性的。`apply()` 执行时宿主插件可能还没 provide，cordis 又不会
* 回头补注入 —— 一次性 `ctx.get()` 快照会永远停在 undefined，让依赖该服务的
* provider 永远停在 `unsupported`。每次查询现取，才能跨过加载顺序。
*/
function hostService(deps, name) {
	const value = deps[name];
	if (value === null || value === void 0) return null;
	return (typeof value === "function" ? value() : value) ?? null;
}
async function queryBuiltInBalance(spec, credential, deps, now) {
	const scheme = schemeOfAdapter(spec.adapter);
	const raw = await queryBalance(scheme, spec.baseURL, credential, deps.timeoutMs ?? DEFAULT_TIMEOUT_MS, deps.fetch ?? fetch);
	const remaining = numberOrNull(raw.total);
	if (remaining === null) throw statusError("invalid-response", "balance response is missing a numeric amount");
	const used = numberOrNull(raw.used);
	const total = numberOrNull(raw.limit);
	const balance = {
		remaining,
		...used === null ? {} : { used },
		...total === null ? {} : { total },
		currency: nonEmptyString(raw.currency) ?? "USD",
		unlimited: raw.unlimited === true,
		expiresAt: null,
		available: raw.isAvailable !== false,
		breakdown: {
			granted: numberOrNull(raw.granted),
			toppedUp: numberOrNull(raw.toppedUp)
		}
	};
	return {
		...baseSnapshot(spec, scheme === "deepseek" && raw.isAvailable === false ? "unavailable" : "ok", now),
		balance,
		alert: balanceAlert(balance, spec.monitor.warning)
	};
}
async function queryGeneral(spec, credential, deps, now) {
	const body = await requestJson(new URL("/user/balance", spec.baseURL).href, { headers: {
		authorization: `Bearer ${credential}`,
		accept: "application/json"
	} }, deps);
	const remaining = numberOrNull(body?.balance);
	if (remaining === null) throw statusError("invalid-response", "general balance response is missing balance");
	const balance = {
		remaining,
		currency: nonEmptyString(body?.currency) ?? "USD",
		unlimited: false,
		expiresAt: null
	};
	return {
		...baseSnapshot(spec, "ok", now),
		balance,
		alert: balanceAlert(balance, spec.monitor.warning)
	};
}
const LEGACY_NEW_API_QUOTA_PER_UNIT = 5e5;
function legacyNewApiQuotaStatus() {
	return {
		quotaPerUnit: LEGACY_NEW_API_QUOTA_PER_UNIT,
		quotaUnitFallback: true,
		displayType: "USD",
		usdExchangeRate: 1
	};
}
function normalizeNewApiQuotaStatus(body) {
	const rawUnit = numberOrNull(body?.data?.quota_per_unit);
	const quotaUnitFallback = rawUnit === null || rawUnit <= 0;
	const quotaPerUnit = quotaUnitFallback ? LEGACY_NEW_API_QUOTA_PER_UNIT : rawUnit;
	const rawDisplayType = body?.data?.quota_display_type;
	let displayType = "USD";
	if (rawDisplayType !== void 0 && rawDisplayType !== null && rawDisplayType !== "") {
		const normalized = nonEmptyString(rawDisplayType);
		if (normalized === null) throw statusError("invalid-response", "New API quota display type is invalid");
		displayType = normalized.toUpperCase();
	}
	if (displayType === "USD") return {
		quotaPerUnit,
		quotaUnitFallback,
		displayType,
		usdExchangeRate: 1
	};
	if (displayType === "CNY") {
		const usdExchangeRate = numberOrNull(body?.data?.usd_exchange_rate);
		if (usdExchangeRate === null || usdExchangeRate <= 0) throw statusError("invalid-response", "New API CNY display requires a positive USD exchange rate");
		return {
			quotaPerUnit,
			quotaUnitFallback,
			displayType,
			usdExchangeRate
		};
	}
	throw statusError("unsupported", "New API quota display type is unsupported");
}
async function queryNewApiQuotaStatus(spec, deps) {
	try {
		return normalizeNewApiQuotaStatus(await requestJson(new URL("/api/status", spec.baseURL).href, { headers: { accept: "application/json" } }, deps));
	} catch (error) {
		if (failureDetails(error).httpStatus === 404 || failureDetails(error).httpStatus === 405) return legacyNewApiQuotaStatus();
		throw error;
	}
}
function newApiQuotaAmount(value, quotaStatus) {
	const rawQuota = numberOrNull(value);
	return rawQuota === null ? null : rawQuota / quotaStatus.quotaPerUnit * quotaStatus.usdExchangeRate;
}
async function queryNewApiFallback(spec, credentials, deps, now) {
	const ref = spec.monitor.fallbackCredentialRef;
	const token = await resolveCredential(credentials, ref);
	if (token === "") return unavailableSnapshot(spec, "unsupported", now, { missingCredentials: ref === void 0 ? [] : [ref] });
	const headers = {
		authorization: `Bearer ${token}`,
		accept: "application/json"
	};
	const userId = await resolveCredential(credentials, spec.monitor.fallbackUserIdRef);
	if (userId !== "") headers["new-api-user"] = userId;
	const [body, quotaStatus] = await Promise.all([requestJson(new URL("/api/user/self", spec.baseURL).href, { headers }, deps), queryNewApiQuotaStatus(spec, deps)]);
	if (body?.success === false || body?.data === null || typeof body?.data !== "object") throw statusError("invalid-response", "New API user response is invalid");
	const remainingQuota = numberOrNull(body.data.quota);
	const usedQuota = numberOrNull(body.data.used_quota);
	const remaining = newApiQuotaAmount(remainingQuota, quotaStatus);
	const used = newApiQuotaAmount(usedQuota, quotaStatus);
	if (remaining === null) throw statusError("invalid-response", "New API user response is missing quota");
	const balance = {
		remaining,
		...used === null ? {} : {
			used,
			total: newApiQuotaAmount(remainingQuota + usedQuota, quotaStatus)
		},
		currency: quotaStatus.displayType,
		unlimited: false,
		expiresAt: null
	};
	return {
		...baseSnapshot(spec, "ok", now),
		plan: nonEmptyString(body.data.group) ?? void 0,
		balance,
		alert: balanceAlert(balance, spec.monitor.warning),
		source: "management-fallback",
		quotaUnit: quotaStatus.quotaPerUnit,
		quotaUnitFallback: quotaStatus.quotaUnitFallback
	};
}
async function queryNewApi(spec, credentials, credential, deps, now) {
	let body;
	try {
		body = await requestJson(new URL("/api/usage/token/", spec.baseURL).href, { headers: {
			authorization: `Bearer ${credential}`,
			accept: "application/json"
		} }, deps);
	} catch (error) {
		if (failureDetails(error).httpStatus === 404 || failureDetails(error).httpStatus === 405) return queryNewApiFallback(spec, credentials, deps, now);
		throw error;
	}
	if (body?.code !== true || body?.data === null || typeof body?.data !== "object") throw statusError("invalid-response", "New API token response is invalid");
	const available = numberOrNull(body.data.user_quota?.total_available);
	if (available === null) return unavailableSnapshot(spec, "ok", now, { source: "user-quota" });
	const used = numberOrNull(body.data.user_quota?.total_used);
	const quotaStatus = await queryNewApiQuotaStatus(spec, deps);
	const balance = {
		remaining: newApiQuotaAmount(available, quotaStatus),
		...used === null ? {} : {
			used: newApiQuotaAmount(used, quotaStatus),
			total: newApiQuotaAmount(available + used, quotaStatus)
		},
		currency: quotaStatus.displayType,
		unlimited: false,
		expiresAt: null
	};
	return {
		...baseSnapshot(spec, "ok", now),
		plan: nonEmptyString(body.data.name) ?? void 0,
		balance,
		alert: balanceAlert(balance, spec.monitor.warning),
		source: "user-quota",
		quotaUnit: quotaStatus.quotaPerUnit,
		quotaUnitFallback: quotaStatus.quotaUnitFallback
	};
}
function amountWindow(kind, usedValue, limitValue, remainingValue, resetsAt) {
	const limit = numberOrNull(limitValue);
	if (limit === null || limit <= 0) return null;
	const remaining = numberOrNull(remainingValue);
	const used = numberOrNull(usedValue) ?? (remaining === null ? null : limit - remaining);
	if (used === null) return null;
	const usedPercent = round1(Math.max(0, Math.min(100, used / limit * 100)));
	const reset = toIso(resetsAt);
	return {
		kind,
		usedPercent,
		remainingPercent: round1(100 - usedPercent),
		...reset === null ? {} : { resetsAt: reset }
	};
}
function sub2ApiWindowKind(value) {
	const kind = nonEmptyString(value) ?? "quota";
	if (kind === "5h") return "session";
	if (kind === "1d") return "daily";
	if (kind === "7d") return "weekly";
	return kind;
}
function sub2ApiSubscription(spec, body, now) {
	const windows = [];
	if (body.mode === "quota_limited") {
		const quota = body.quota;
		if (quota === null || typeof quota !== "object" || Array.isArray(quota)) throw statusError("invalid-response", "Sub2API quota response is missing quota");
		const total = amountWindow("quota", quota.used, quota.limit, quota.remaining, body.expires_at);
		if (total !== null) windows.push(total);
		for (const entry of Array.isArray(body.rate_limits) ? body.rate_limits : []) {
			if (entry === null || typeof entry !== "object" || Array.isArray(entry)) continue;
			const window = amountWindow(sub2ApiWindowKind(entry.window), entry.used, entry.limit, entry.remaining, entry.reset_at);
			if (window !== null) windows.push(window);
		}
	} else {
		const subscription = body.subscription;
		if (subscription === null || typeof subscription !== "object" || Array.isArray(subscription)) throw statusError("invalid-response", "Sub2API subscription response is missing subscription limits");
		for (const period of [
			"daily",
			"weekly",
			"monthly"
		]) {
			const window = amountWindow(period, subscription[`${period}_usage_usd`], subscription[`${period}_limit_usd`], null, null);
			if (window !== null) windows.push(window);
		}
	}
	if (windows.length === 0) throw statusError("invalid-response", "Sub2API response has no usable quota windows");
	return {
		...baseSnapshot(spec, "ok", now),
		mode: "subscription",
		plan: nonEmptyString(body.planName) ?? nonEmptyString(body.plan_name) ?? "Sub2API",
		windows,
		alert: subscriptionAlert(windows)
	};
}
/** Parse a Sub2API /v1/usage body into a normalized account snapshot (balance or subscription windows). */
function parseSub2ApiUsage(spec, body, now) {
	if (body === null || typeof body !== "object" || Array.isArray(body)) throw statusError("invalid-response", "Sub2API response must be an object");
	if (body.isValid === false || body.is_active === false) throw statusError("unauthorized", "Sub2API key is invalid");
	const hasSubscription = body.subscription !== null && typeof body.subscription === "object" && !Array.isArray(body.subscription);
	if (body.mode === "quota_limited" || hasSubscription) return sub2ApiSubscription(spec, body, now);
	const remaining = numberOrNull(body.balance ?? body.remaining);
	if (remaining === null) throw statusError("invalid-response", "Sub2API response is missing a numeric balance");
	const balance = {
		remaining,
		currency: nonEmptyString(body.unit) ?? "USD",
		unlimited: false,
		expiresAt: toIso(body.expires_at)
	};
	return {
		...baseSnapshot(spec, "ok", now),
		mode: "balance",
		plan: nonEmptyString(body.planName) ?? nonEmptyString(body.plan_name) ?? void 0,
		balance,
		alert: balanceAlert(balance, spec.monitor.warning)
	};
}
async function querySub2Api(spec, credential, deps, now) {
	return parseSub2ApiUsage(spec, await requestJson(new URL("/v1/usage", spec.baseURL).href, { headers: {
		authorization: `Bearer ${credential}`,
		accept: "application/json"
	} }, deps), now);
}
/**
* Parse the Sub2API dashboard `{ code, message, data }` envelope.
*
* Sub2API reports business failures with HTTP 200 and a non-zero `code`, and
* envelopes can be missing entirely on some endpoints, so callers decide how
* strictly to validate the `data` payload. `code === 0` means success.
*/
function sub2apiEnvelope(body) {
	if (body === null || typeof body !== "object" || Array.isArray(body)) throw statusError("invalid-response", "Sub2API response must be an object");
	const code = body.code;
	const message = typeof body.message === "string" ? body.message : "";
	if (code !== 0) {
		const err = statusError("invalid-response", message !== "" ? `Sub2API: ${message}` : "Sub2API returned a business error");
		if (/invalid|unauthor|password|credential|login|expired|refresh/i.test(message)) err.providerStatus = "unauthorized";
		throw err;
	}
	return body;
}
/**
* Detection cache for auto-detected Sub2API panels, keyed by the provider's
* config key so we only probe once per (provider × config) even across the
* five-minute background refreshes.
*/
function sub2apiDetection(deps) {
	if (deps.sub2apiDetection === void 0 || deps.sub2apiDetection === null) deps.sub2apiDetection = /* @__PURE__ */ new Map();
	return deps.sub2apiDetection;
}
/**
* Probe whether a relay endpoint is a real Sub2API panel.
*
* Real Sub2API panels expose the public `GET /api/v1/settings/public` route
* (envelope `{ code: 0, data: { affiliate_enabled: boolean } }`) which neither
* One/New-API nor passion-style gateways provide, so this is a cheap, read-only,
* capability fingerprint for auto-detection. Results are cached per config key.
*/
async function probeSub2ApiPanel(spec, deps) {
	const cache = sub2apiDetection(deps);
	const key = spec.configKey;
	if (cache.has(key)) return cache.get(key);
	let detected = false;
	try {
		const settings = sub2apiEnvelope(await requestJson(new URL(SUB2API_PUBLIC_SETTINGS_PATH, spec.baseURL).href, { headers: { accept: "application/json" } }, deps))?.data;
		detected = settings !== null && typeof settings === "object" && !Array.isArray(settings) && typeof settings.affiliate_enabled === "boolean";
	} catch {
		detected = false;
	}
	cache.set(key, detected);
	return detected;
}
/**
* Build a sub2api-auth spec from an auto-detected panel's provider. It reuses
* the provider's own inference apiKeyEnv (already configured in the model) —
* the same credential model as CC Switch's General usage template — so no
* separate panel credential is needed. The apiKeyRef stays the provider's.
*/
function sub2apiAuthSpec(spec) {
	return {
		...spec,
		adapter: "sub2api-auth",
		mode: "balance",
		provenanceHint: "experimental"
	};
}
/**
* Query a Sub2API panel's balance with the provider's own inference API key.
*
* No separate dashboard credential is required — the model-configured apiKeyEnv
* is reused. Two key-accessible endpoints are tried in order:
*   1. `GET {baseUrl}/user/balance` (CC Switch General shape, reads
*      `response.balance`); some panels expose this and some do not.
*   2. `GET {baseUrl}/v1/usage` (the legacy Sub2API/passion shape parsed by
*      `parseSub2ApiUsage`), which real panels commonly expose.
* Panels whose SPA serves HTML for unknown routes (returning non-JSON for
* `/user/balance`) fall through to `/v1/usage` instead of failing.
*/
async function querySub2ApiAuth(spec, credentials, deps, now) {
	const credential = await resolveCredential(credentials, spec.apiKeyRef);
	if (credential === "") return unavailableSnapshot(spec, "not-configured", now, { missingCredentials: [spec.apiKeyRef === void 0 ? "<apiKey>" : spec.apiKeyRef] });
	let balanceBody = null;
	try {
		balanceBody = await requestJson(new URL(SUB2API_BALANCE_PATH, spec.baseURL).href, { headers: {
			authorization: `Bearer ${credential}`,
			accept: "application/json"
		} }, deps);
	} catch (error) {
		if (!(failureDetails(error).providerStatus === "unsupported" || failureDetails(error).providerStatus === "invalid-response")) throw error;
		balanceBody = null;
	}
	const remaining = balanceBody === null ? null : numberOrNull(balanceBody?.balance) ?? numberOrNull(balanceBody?.data?.balance) ?? numberOrNull(balanceBody?.remaining) ?? numberOrNull(balanceBody?.data?.remaining);
	if (remaining !== null) {
		let used = null;
		try {
			const cost = numberOrNull((await requestJson(new URL(SUB2API_USAGE_STATS_PATH, spec.baseURL).href, { headers: {
				authorization: `Bearer ${credential}`,
				accept: "application/json"
			} }, deps))?.data?.total_actual_cost);
			if (cost !== null) used = cost;
		} catch {}
		const balance = {
			remaining,
			...used === null ? {} : { used },
			currency: nonEmptyString(balanceBody?.unit) ?? "USD",
			unlimited: false,
			expiresAt: null
		};
		return {
			...baseSnapshot(spec, "ok", now),
			...nonEmptyString(balanceBody?.planName) === null ? {} : { plan: balanceBody.planName },
			balance,
			alert: balanceAlert(balance, spec.monitor.warning)
		};
	}
	try {
		return parseSub2ApiUsage(spec, await requestJson(new URL("/v1/usage", spec.baseURL).href, { headers: {
			authorization: `Bearer ${credential}`,
			accept: "application/json"
		} }, deps), now);
	} catch (error) {
		if (balanceBody !== null && typeof balanceBody === "object") failureDetails(error).safeReason = "sub2api-balance-shape-unrecognized";
		throw error;
	}
}
function customBalance(spec, body, now) {
	const extract = spec.monitor.extract;
	const root = jsonPointer(body, extract.root ?? "");
	if (root === void 0) throw statusError("invalid-response", "custom response root is missing");
	if (mapped(root, extract.valid) === false) throw statusError("invalid-response", String(mapped(root, extract.invalidMessage) ?? "custom response is marked invalid"));
	const divisor = numberOrNull(extract.divisor) ?? 1;
	const remainingValue = mapped(root, extract.remaining);
	const remainingSource = mappedSource(root, extract.remaining);
	const usedRaw = numberOrNull(mapped(root, extract.used));
	const totalRaw = numberOrNull(mapped(root, extract.total));
	let remainingRaw;
	if (remainingSource !== void 0 && remainingSource !== null) {
		remainingRaw = numberOrNull(remainingValue);
		if (remainingRaw === null) throw statusError("invalid-response", "custom response remaining is not numeric");
	} else if (usedRaw !== null && totalRaw !== null) remainingRaw = Math.max(0, totalRaw - usedRaw);
	else throw statusError("invalid-response", "custom response is missing a numeric balance");
	const balance = {
		remaining: remainingRaw / divisor,
		...usedRaw === null ? {} : { used: usedRaw / divisor },
		...totalRaw === null ? {} : { total: totalRaw / divisor },
		currency: nonEmptyString(mapped(root, extract.currency)) ?? nonEmptyString(extract.currencyValue) ?? "USD",
		unlimited: booleanOrNull(mapped(root, extract.unlimited)) === true,
		expiresAt: toIso(mapped(root, extract.expiresAt))
	};
	return {
		...baseSnapshot(spec, "ok", now),
		plan: nonEmptyString(mapped(root, extract.plan)) ?? void 0,
		balance,
		alert: balanceAlert(balance, spec.monitor.warning)
	};
}
function customSubscription(spec, body, now) {
	const extract = spec.monitor.extract;
	const root = jsonPointer(body, extract.root ?? "");
	const items = mapped(root, extract.items);
	if (!Array.isArray(items)) throw statusError("invalid-response", "custom response items must be an array");
	const windows = [];
	for (const item of items) {
		const used = numberOrNull(mapped(item, extract.usedPercent));
		const remaining = numberOrNull(mapped(item, extract.remainingPercent));
		if (used === null && remaining === null) continue;
		const usedPercent = round1(Math.max(0, Math.min(100, used ?? 100 - remaining)));
		const remainingPercent = round1(Math.max(0, Math.min(100, remaining ?? 100 - used)));
		windows.push({
			kind: nonEmptyString(mapped(item, extract.kind)) ?? "quota",
			usedPercent,
			remainingPercent,
			...toIso(mapped(item, extract.resetsAt)) === null ? {} : { resetsAt: toIso(mapped(item, extract.resetsAt)) }
		});
	}
	if (windows.length === 0) throw statusError("invalid-response", "custom response has no usable quota windows");
	return {
		...baseSnapshot(spec, "ok", now),
		plan: nonEmptyString(mapped(root, extract.plan)) ?? void 0,
		windows,
		alert: subscriptionAlert(windows)
	};
}
function accountClientMetadata(raw) {
	const value = raw;
	if (value === null || value === void 0 || typeof value !== "object") return null;
	const version = nonEmptyString(value.version);
	const locale = nonEmptyString(value.locale);
	const timezoneOffsetSeconds = numberOrNull(value.timezoneOffsetSeconds);
	if (version === null || version.length > 128 || locale === null || locale.length > 64) return null;
	if (timezoneOffsetSeconds === null || !Number.isInteger(timezoneOffsetSeconds) || Math.abs(timezoneOffsetSeconds) > 86400) return null;
	return {
		version,
		locale,
		timezoneOffsetSeconds
	};
}
function deepSeekAccountWallets(details) {
	const byCurrency = /* @__PURE__ */ new Map();
	const add = (entries, field) => {
		for (const entry of Array.isArray(entries) ? entries : []) {
			const currency = entry?.currency === "CNY" || entry?.currency === "USD" ? entry.currency : null;
			const amount = numberOrNull(entry?.balance);
			if (currency === null || amount === null) continue;
			const current = byCurrency.get(currency) ?? {
				currency,
				toppedUp: 0,
				granted: 0
			};
			current[field] += amount;
			byCurrency.set(currency, current);
		}
	};
	add(details?.value, "toppedUp");
	add(details?.bonusWallets, "granted");
	return [...byCurrency.values()].map((wallet) => ({
		currency: wallet.currency,
		remaining: wallet.toppedUp + wallet.granted,
		breakdown: {
			toppedUp: wallet.toppedUp,
			granted: wallet.granted
		}
	}));
}
async function queryDeepSeekAccount(spec, deps, now) {
	const service = hostService(deps, "deepseekAccount");
	if (service === null || service === void 0 || typeof service.getState !== "function" || typeof service.getBalance !== "function") return unavailableSnapshot(spec, "unsupported", now);
	if ((await service.getState())?.status !== "credential-stored") return unavailableSnapshot(spec, "signed-out", now, { source: "host-account" });
	const client = accountClientMetadata(deps.clientMetadata);
	if (client === null) return unavailableSnapshot(spec, "unavailable", now, { source: "host-account" });
	const details = await service.getBalance(client);
	if (details === null) return unavailableSnapshot(spec, (await service.getState())?.status === "credential-stored" ? "unavailable" : "signed-out", now, { source: "host-account" });
	if (details?.status !== "ready") return unavailableSnapshot(spec, "unavailable", now, { source: "host-account" });
	const wallets = deepSeekAccountWallets(details);
	const single = wallets.length === 1 ? wallets[0] : null;
	const balance = {
		wallets,
		remaining: single?.remaining ?? null,
		currency: single?.currency ?? null,
		unlimited: false,
		expiresAt: null,
		...single === null ? {} : { breakdown: single.breakdown }
	};
	return {
		...baseSnapshot(spec, "ok", now),
		balance,
		alert: single === null ? {
			level: "unknown",
			metric: "balance",
			value: null
		} : balanceAlert(balance, spec.monitor.warning),
		source: "host-account"
	};
}
/**
* 把 codearts 插件的一个积分包折算成一条 quota window。
*
* ⚠️ `usedPercent` 用 `used/total` 而不是 `1-remaining` —— 两者在包被按比例
* 扣减时相等，但包过期后 `remaining` 会归零而 `total` 仍是原始额度，此时
* `1-remaining` 会谎报成「用光 100%」。`used/total` 说的是「消耗了多少」。
*/
function codeartsPackageWindow(pkg, index) {
	let remaining = numberOrNull(pkg?.remaining);
	const total = numberOrNull(pkg?.total);
	const used = numberOrNull(pkg?.used);
	for (const field of [
		"remaining",
		"total",
		"used"
	]) {
		const raw = pkg?.[field];
		const value = numberOrNull(raw);
		if (value !== null && value < 0) return null;
		if (raw !== null && raw !== void 0 && raw !== "" && value === null) return null;
	}
	const expired = pkg?.active === false;
	if (remaining === null && !expired && total !== null && total > 0 && used !== null) remaining = Math.max(0, total - used);
	if (remaining === null && !(expired && total !== null && total > 0 && used !== null)) return null;
	const denominator = total ?? (expired || used === null ? null : remaining + used);
	const consumed = used ?? (!expired && denominator > 0 && remaining <= denominator ? denominator - remaining : null);
	const usedPercent = denominator !== null && Number.isFinite(denominator) && denominator > 0 && consumed !== null ? round1(Math.max(0, Math.min(100, consumed / denominator * 100))) : null;
	const expiresAt = toIso(pkg?.expiredTime) ?? toIso(pkg?.deductionEndTime);
	return {
		kind: expired ? "expired" : "quota",
		...remaining === null ? {} : { amount: remaining },
		...usedPercent === null ? {} : {
			usedPercent,
			...expired ? {} : { remainingPercent: round1(100 - usedPercent) }
		},
		...expiresAt === null ? {} : { resetsAt: expiresAt },
		label: nonEmptyString(pkg?.name) ?? `积分包 ${index + 1}`,
		unit: nonEmptyString(pkg?.unit) ?? "credit"
	};
}
/**
* 经 codearts 插件的进程内服务读余额（不碰 AK/SK、不走 HTTP）。
*
* 数据所有权：凭据与签名协议全在 dsh-codearts-auth 插件内；本插件只读它算好的
* `CreditBalance` 结果 —— 与 README 里 DeepSeek Account 那一行同一套约定。
*
* ⚠️ 查不到时**不显示成 0**：0 是「已用光」的语义，把「查询失败」显示成 0 会
* 让用户以为积分没了（codearts 侧同样如此约定，见 collectCreditBalances）。
*/
async function queryCodeArtsCredits(spec, deps, now) {
	const service = hostService(deps, "creditBalance");
	if (service === null || service === void 0 || typeof service.creditsBalances !== "function") return unavailableSnapshot(spec, "unsupported", now, { source: "codearts-plugin" });
	let result;
	try {
		result = await service.creditsBalances(spec.id);
	} catch (caught) {
		if (caught instanceof Error && caught.name === "UnsupportedProviderError") return unavailableSnapshot(spec, "unsupported", now, { source: "codearts-plugin" });
		return unavailableSnapshot(spec, "unavailable", now, {
			source: "codearts-plugin",
			reason: safeReasonOf(caught) ?? "unknown"
		});
	}
	if (!Array.isArray(result?.accounts)) return unavailableSnapshot(spec, "invalid-response", now, {
		source: "codearts-plugin",
		reason: "upstream-invalid-response"
	});
	const accounts = result.accounts;
	if (accounts.length === 0) return unavailableSnapshot(spec, "not-configured", now, { source: "codearts-plugin" });
	const windows = [];
	const failures = [];
	const accountLabels = [];
	for (const account of accounts) {
		if (account?.stale === true || typeof account?.error === "string" && account.error !== "") {
			failures.push("unknown");
			continue;
		}
		const balance = account?.balance;
		if (balance === null || balance === void 0) {
			failures.push("unknown");
			continue;
		}
		accountLabels.push(nonEmptyString(account.nickname) ?? String(account.accountId ?? ""));
		const packages = Array.isArray(balance.packages) ? balance.packages : [];
		const before = windows.length;
		for (const [index, pkg] of packages.entries()) {
			const window = codeartsPackageWindow(pkg, index);
			if (window === null) continue;
			windows.push({
				...window,
				account: account.accountId
			});
		}
		if (windows.length === before) {
			const total = numberOrNull(balance.total);
			if (total !== null && total >= 0) windows.push({
				kind: "quota",
				amount: total,
				label: nonEmptyString(account.nickname) ?? "剩余额度",
				unit: nonEmptyString(balance.unit) ?? "credit",
				account: account.accountId
			});
		}
	}
	if (windows.length === 0) return unavailableSnapshot(spec, "unavailable", now, {
		source: "codearts-plugin",
		reason: "unknown"
	});
	return {
		...baseSnapshot(spec, "ok", now),
		plan: accountLabels.length === 1 ? windows[0].label ?? void 0 : `${accountLabels.length} 个账号`,
		windows,
		alert: subscriptionAlert(windows),
		source: "codearts-plugin",
		...failures.length === 0 ? {} : { partial: failures }
	};
}
function assertNoCredentialEcho(snapshot, credential) {
	if (credential === "") return;
	const normalizeEscapes = (value) => value.replace(/%[0-9a-f]{2}/gi, (escape) => escape.toLowerCase());
	const encoded = new URLSearchParams({ key: credential }).toString().slice(4);
	const variants = [
		credential,
		encodeURIComponent(credential.toWellFormed()),
		encoded
	].map(normalizeEscapes);
	const inspect = (value) => {
		if (typeof value === "string" && variants.some((secret) => normalizeEscapes(value).includes(secret))) throw statusError("invalid-response", "custom response contains credential material");
		if (value !== null && typeof value === "object") for (const item of Object.values(value)) inspect(item);
	};
	inspect({
		plan: snapshot.plan,
		balance: snapshot.balance,
		windows: snapshot.windows
	});
}
async function queryDeclarative(spec, credentials, deps, now) {
	const ref = spec.monitor.request.auth?.credentialRef ?? spec.apiKeyRef;
	const credential = await resolveCredential(credentials, ref);
	if (spec.monitor.request.auth !== void 0 && credential === "") return unavailableSnapshot(spec, "not-configured", now, { missingCredentials: ref === void 0 ? [] : [ref] });
	const body = await requestJson(customURL(spec, credential), {
		method: "GET",
		headers: customHeaders(spec, credential)
	}, deps);
	const snapshot = spec.mode === "subscription" ? customSubscription(spec, body, now) : customBalance(spec, body, now);
	assertNoCredentialEcho(snapshot, credential);
	return snapshot;
}
/** Query one adapter and return a secret-free normalized account snapshot. */
async function queryAccount(spec, credentials, deps = {}) {
	const now = (deps.now ?? Date.now)();
	if (spec === null || spec === void 0) return annotateQuerySnapshot(unavailableSnapshot({
		id: "unknown",
		displayName: "Unknown",
		adapter: null,
		mode: "balance"
	}, "unsupported", now), {
		attempted: false,
		succeeded: false
	});
	let attempted = false;
	const upstreamFetch = deps.fetch === void 0 ? (url, init) => pinnedFetch(url, init, spec, deps) : deps.fetch;
	const safeDeps = {
		...deps,
		fetch: (url, init) => {
			attempted = true;
			return upstreamFetch(url, init);
		}
	};
	const finish = (snapshot, succeeded = snapshot.status === "ok") => annotateQuerySnapshot(snapshot, {
		attempted: attempted || succeeded,
		succeeded
	});
	try {
		if (spec.adapter === null || spec.mode === null) {
			if (await resolveCredential(credentials, spec.apiKeyRef) === "") return finish(unavailableSnapshot(spec, "unsupported", now), false);
			const probeable = {
				...spec,
				adapter: null,
				mode: "balance"
			};
			if (await probeSub2ApiPanel(probeable, safeDeps)) return finish(await querySub2ApiAuth(sub2apiAuthSpec(probeable), credentials, safeDeps, now));
			return finish(unavailableSnapshot(spec, "unsupported", now), false);
		}
		if (spec.adapter === "quota-source") {
			attempted = true;
			const registry = hostService(deps, "usageQuota");
			if (!registry || registry.protocolVersion !== 1) return finish(unavailableSnapshot(spec, "unsupported", now));
			const snapshot = await registry.read(spec.quotaBinding.id, spec.quotaBinding.revision, { signal: AbortSignal.timeout(deps.timeoutMs ?? DEFAULT_TIMEOUT_MS) });
			const result = quotaAccountSnapshot(baseSnapshot(spec, "ok", now), snapshot);
			return finish({
				...baseSnapshot(spec, "ok", now),
				...result,
				alert: subscriptionAlert(result.windows)
			});
		}
		if (spec.adapter === "deepseek-account") return finish(await queryDeepSeekAccount(spec, safeDeps, now));
		if (spec.adapter === "ark-coding-plan-cli") {
			attempted = Boolean(spec.monitor.arkCLIExecutable && spec.monitor.arkCLIProfile);
			const provider = await queryArkCodingPlan(spec.monitor, safeDeps);
			return finish({
				...baseSnapshot(spec, provider.status, now),
				...provider,
				alert: subscriptionAlert(provider.windows)
			});
		}
		if (spec.adapter === "declarative") return finish(await queryDeclarative(spec, credentials, safeDeps, now));
		if (spec.adapter === "sub2api-auth") return finish(await querySub2ApiAuth(spec, credentials, safeDeps, now));
		if (spec.adapter === "codearts-credits") return finish(await queryCodeArtsCredits(spec, safeDeps, now));
		if (spec.overrideIncomplete === true) return finish(unavailableSnapshot(spec, "not-configured", now, { missingCredentials: [] }), false);
		const resolvedCredential = await resolveAccountCredential(spec, credentials);
		const credential = resolvedCredential.value;
		if ((spec.adapter !== "opencode-go" || !spec.useDefaultOpenCodeCredential) && credential === "") return finish(unavailableSnapshot(spec, "not-configured", now, { missingCredentials: resolvedCredential.ref === void 0 ? [] : [resolvedCredential.ref] }), false);
		if (schemeOfAdapter(spec.adapter) !== null) return finish(await queryBuiltInBalance(spec, credential, safeDeps, now), true);
		if (spec.adapter === "general") return finish(await queryGeneral(spec, credential, safeDeps, now));
		if (spec.adapter === "new-api") return finish(await queryNewApi(spec, credentials, credential, safeDeps, now));
		if (spec.adapter === "sub2api") return finish(await querySub2Api(spec, credential, safeDeps, now));
		const subscriptionId = SUBSCRIPTION_IDS[spec.adapter] ?? "opencode-go";
		const provider = await collectSubscription(subscriptionId, credentials, {
			apiKeyRef: resolvedCredential.ref,
			allowLocalAuth: spec.adapter === "opencode-go" ? spec.useDefaultOpenCodeCredential : void 0,
			commandCodeVersion: spec.monitor.commandCodeVersion,
			region: spec.adapter === "zai-token-plan" ? zaiRegionHintOf(spec) : spec.monitor.region,
			zaiRegionOverride: spec.adapter === "zai-token-plan" ? resolvedCredential.region ?? nonEmptyString(spec.monitor?.region) ?? void 0 : void 0,
			inferredRegion: spec.adapter === "minimax-token-plan" ? minimaxRouteRegionOf(spec) : void 0,
			baseURL: spec.monitor.usageBaseURL
		}, safeDeps);
		const windows = Array.isArray(provider.windows) ? provider.windows : [];
		const reason = providerReasonOf(provider.reason, provider.status);
		const balance = provider.credits ?? null;
		const alert = windows.length > 0 || balance === null ? subscriptionAlert(windows) : balanceAlert(balance, spec.monitor.warning);
		return finish({
			...baseSnapshot(spec, provider.status, now),
			plan: provider.plan,
			windows,
			...balance === null ? {} : { balance },
			alert,
			...provider.missingCredentials === void 0 ? {} : { missingCredentials: provider.missingCredentials },
			...reason === null ? {} : { reason }
		});
	} catch (error) {
		const reason = safeReasonOf(error);
		return finish(unavailableSnapshot(spec, failureDetails(error).name === "QuotaBindingChanged" ? "unsupported" : statusOf(error), now, reason === null ? {} : { reason }), false);
	}
}
function isTransient(status) {
	return status === "unavailable" || status === "rate-limited" || status === "invalid-response";
}
function mergeRefreshHealth(previous, current) {
	const lastSuccessAt = previous?.lastSuccessAt ?? (previous?.status === "ok" ? previous.fetchedAt : null);
	const attempted = current[HEALTH_ATTEMPTED] === true;
	const successful = current[HEALTH_SUCCEEDED] === true || current.status === "ok";
	const attemptAt = attempted ? current.fetchedAt : previous?.lastAttemptAt ?? null;
	const currentWithHealth = {
		...current,
		lastAttemptAt: attemptAt,
		lastSuccessAt: successful ? current.observedAt ?? attemptAt : lastSuccessAt,
		stale: current.stale === true
	};
	delete currentWithHealth.ageMs;
	if (!(!successful && lastSuccessAt !== null && (previous?.status === "ok" || previous?.stale === true) && isTransient(current.status))) return currentWithHealth;
	const stale = {
		...previous,
		status: current.status,
		fetchedAt: attemptAt,
		lastAttemptAt: attemptAt,
		lastSuccessAt,
		provenance: current.provenance ?? previous.provenance ?? "unknown",
		stale: true
	};
	delete stale.ageMs;
	if (current.reason === void 0) delete stale.reason;
	else stale.reason = current.reason;
	return stale;
}
/**
* In-memory account cache with per-provider single-flight, health history, and
* adaptive due-time calculation. One server-owned scheduler coordinates it
* with the existing local token-usage aggregation lifecycle.
*/
function createAccountService({ credentials, getProviders, config = { monitors: {} }, deps = {} }) {
	const cache = /* @__PURE__ */ new Map();
	const inflight = /* @__PURE__ */ new Map();
	const refreshGenerations = /* @__PURE__ */ new Map();
	const now = deps.now ?? Date.now;
	const refreshConfig = {
		...DEFAULT_REFRESH_CONFIG,
		...config.refresh ?? {}
	};
	const autoRefreshEnabled = refreshConfig.enabled !== false;
	const policyOverrides = {
		activeMs: refreshConfig.activeMs,
		detailMs: refreshConfig.detailMs,
		backgroundMs: refreshConfig.backgroundMs,
		...deps.refreshMs === void 0 ? {} : { backgroundMs: deps.refreshMs },
		...deps.refreshPolicy ?? {}
	};
	const activeProviders = /* @__PURE__ */ new Set();
	const activityTouches = /* @__PURE__ */ new Map();
	const policyListeners = /* @__PURE__ */ new Set();
	const activityTtlMs = deps.activityTtlMs ?? 6e5;
	const sub2apiDetection = deps.sub2apiDetection ?? /* @__PURE__ */ new Map();
	const serviceDeps = {
		...deps,
		sub2apiDetection
	};
	let previousDeepSeekAccount = null;
	let deepSeekAccountGeneration = 0;
	let previousCreditBalance = null;
	let creditBalanceGeneration = 0;
	let previousQuotaRegistry = null;
	let quotaRegistryGeneration = 0;
	async function specs() {
		const providers = (await getProviders()).map((provider) => ({ ...provider }));
		const deepseekAccount = hostService(deps, "deepseekAccount");
		const serviceIdentity = deepseekAccount?.[Symbol.for("cordis.original")] ?? deepseekAccount;
		if (serviceIdentity !== previousDeepSeekAccount) {
			previousDeepSeekAccount = serviceIdentity;
			deepSeekAccountGeneration += 1;
		}
		if (deepseekAccount !== null && !providers.some((provider) => provider.id === "deepseek-account")) providers.push({
			id: "deepseek-account",
			displayName: "DeepSeek Account"
		});
		let creditBalance = null;
		try {
			creditBalance = hostService(deps, "creditBalance");
		} catch {}
		const creditIdentity = creditBalance?.[Symbol.for("cordis.original")] ?? creditBalance;
		if (creditIdentity !== previousCreditBalance) {
			previousCreditBalance = creditIdentity;
			creditBalanceGeneration += 1;
		}
		if (creditBalance !== null && typeof creditBalance.supportedProviders === "function") {
			let supplied = [];
			try {
				const entries = creditBalance.supportedProviders();
				if (Array.isArray(entries)) supplied = entries;
				else if (entries instanceof Promise) entries.catch(() => {});
			} catch {}
			for (const entry of supplied) {
				const id = nonEmptyString(entry?.id);
				if (id === null || providers.some((provider) => provider.id === id)) continue;
				providers.push({
					id,
					displayName: nonEmptyString(entry?.displayName) ?? id,
					synthetic: true,
					accountService: "creditBalance"
				});
			}
		}
		if (deps.includeLegacyProviders !== false) {
			if (!providers.some((provider) => provider.id === "opencode-go")) providers.push({
				id: "opencode-go",
				displayName: "OpenCode Go"
			});
			if (!providers.some((provider) => provider.id === "zai" || provider.id === "zai-coding-cn")) providers.push({
				id: "zai",
				displayName: "Z.ai",
				apiKeyEnv: "ZAI_API_KEY",
				baseURL: "https://api.z.ai"
			});
			if (!providers.some((provider) => provider.id === "commandcode" || provider.id.startsWith("commandcode-"))) providers.push({
				id: "commandcode",
				displayName: "Command Code",
				apiKeyEnv: "COMMANDCODE_API_KEY",
				baseURL: "https://api.commandcode.ai/provider/v1"
			});
		}
		let quotaRegistry;
		try {
			quotaRegistry = hostService(deps, "usageQuota");
		} catch {}
		const quotaIdentity = quotaRegistry?.[Symbol.for("cordis.original")] ?? quotaRegistry;
		if (quotaIdentity !== previousQuotaRegistry) {
			previousQuotaRegistry = quotaIdentity;
			quotaRegistryGeneration += 1;
		}
		if (quotaRegistry?.protocolVersion === 1) {
			let supplied = [];
			try {
				supplied = quotaRegistry.list();
			} catch {}
			for (const source of Array.isArray(supplied) ? supplied : []) {
				const binding = {
					id: source.id,
					revision: source.revision,
					generation: quotaRegistryGeneration
				};
				let bound = false;
				for (const provider of providers) {
					if (!source.providerRoutes.includes(provider.id) || config.monitors?.[provider.id]?.adapter !== void 0 || resolveProviderIdentity(provider, config).accountAdapter !== null) continue;
					provider.quotaBinding = binding;
					bound = true;
				}
				if (!bound && !providers.some((provider) => provider.id === source.id)) providers.push({
					id: source.id,
					displayName: source.displayName,
					quotaBinding: binding
				});
			}
		}
		const known = new Set(providers.map((provider) => provider.id));
		for (const [providerId, monitor] of Object.entries(config.monitors ?? {})) {
			if (known.has(providerId)) continue;
			if (monitor.adapter === "ark-coding-plan-cli") {
				providers.push({
					id: providerId,
					displayName: nonEmptyString(monitor.displayName) ?? providerId
				});
				known.add(providerId);
				continue;
			}
			const baseURL = nonEmptyString(monitor.usageBaseURL);
			const apiKeyEnv = nonEmptyString((monitor.adapter === "declarative" ? monitor.request?.auth?.credentialRef : void 0) ?? monitor.credentialRef);
			if (baseURL !== null && apiKeyEnv !== null) {
				providers.push({
					id: providerId,
					displayName: nonEmptyString(monitor.displayName) ?? providerId,
					apiKeyEnv,
					baseURL
				});
				known.add(providerId);
			}
		}
		const unknown = Object.keys(config.monitors ?? {}).filter((providerId) => !known.has(providerId));
		if (unknown.length > 0) throw new Error(`account monitor references unknown provider: ${unknown.join(", ")}`);
		return providers.map((provider) => {
			const spec = resolveAccountSpec(provider, config);
			if (spec.adapter === "deepseek-account") spec.configKey += `:host-${deepSeekAccountGeneration}`;
			if (spec.adapter === "codearts-credits") spec.configKey += `:credit-host-${creditBalanceGeneration}`;
			return spec;
		});
	}
	async function specById(providerId) {
		return (await specs()).find((spec) => spec.id === providerId) ?? null;
	}
	function notifyPolicyChange() {
		for (const listener of policyListeners) listener();
	}
	function subscribePolicyChanges(listener) {
		if (typeof listener !== "function") return () => {};
		policyListeners.add(listener);
		return () => policyListeners.delete(listener);
	}
	function touch(providerId, activity) {
		if (typeof providerId !== "string" || providerId === "") return;
		if (activity !== "active" && activity !== "detail") return;
		const at = now();
		const before = activityOf(providerId, at);
		const previous = activityTouches.get(providerId) ?? {};
		activityTouches.set(providerId, {
			...previous,
			[`${activity}At`]: at
		});
		if (activityOf(providerId, at) !== before) notifyPolicyChange();
	}
	function setActiveProviders(providerIds) {
		const next = new Set([...providerIds ?? []].filter((providerId) => typeof providerId === "string" && providerId !== ""));
		const changed = next.size !== activeProviders.size || [...next].some((providerId) => !activeProviders.has(providerId));
		activeProviders.clear();
		for (const providerId of next) activeProviders.add(providerId);
		if (changed) notifyPolicyChange();
	}
	function activityOf(providerId, at) {
		const touched = activityTouches.get(providerId);
		if (activeProviders.has(providerId) || at - (touched?.activeAt ?? -Infinity) < activityTtlMs) return "active";
		if (at - (touched?.detailAt ?? -Infinity) < activityTtlMs) return "detail";
		return "background";
	}
	function policyOf(spec, at) {
		const hit = cache.get(spec.id);
		if (hit?.configKey !== spec.configKey) return refreshPolicy({
			activity: activityOf(spec.id, at),
			status: "pending",
			lastAttemptAt: null
		}, at, policyOverrides);
		return refreshPolicy({
			activity: activityOf(spec.id, at),
			status: hit.account.status,
			rateLimitFailures: hit.rateLimitFailures ?? 0,
			lastAttemptAt: hit.lastEvaluatedAt ?? hit.account.lastAttemptAt ?? hit.account.fetchedAt ?? null
		}, at, policyOverrides);
	}
	async function refresh(spec, clientMetadata = null) {
		const existing = inflight.get(spec.id);
		if (existing?.configKey === spec.configKey) return existing.promise;
		const generation = (refreshGenerations.get(spec.id) ?? 0) + 1;
		refreshGenerations.set(spec.id, generation);
		const promise = queryAccount(spec, credentials, {
			...serviceDeps,
			clientMetadata
		}).then((current) => {
			const previous = cache.get(spec.id);
			const sameConfig = previous?.configKey === spec.configKey;
			const previousAccount = sameConfig ? previous.account : null;
			const previousRateLimitFailures = sameConfig ? previous.rateLimitFailures ?? 0 : 0;
			const next = mergeRefreshHealth(previousAccount, current);
			const successful = current[HEALTH_SUCCEEDED] === true || current.status === "ok";
			const rateLimitFailures = current.status === "rate-limited" ? previousRateLimitFailures + 1 : successful ? 0 : previousRateLimitFailures;
			if (refreshGenerations.get(spec.id) === generation) cache.set(spec.id, {
				configKey: spec.configKey,
				account: next,
				rateLimitFailures,
				lastEvaluatedAt: current.fetchedAt
			});
			return withHealthAge(next, now());
		});
		let entry;
		const tracked = promise.finally(() => {
			if (inflight.get(spec.id) === entry) inflight.delete(spec.id);
		});
		entry = {
			configKey: spec.configKey,
			adapter: spec.adapter,
			promise: tracked
		};
		inflight.set(spec.id, entry);
		return tracked;
	}
	async function get(providerId, { force = false, activity = null, clientMetadata = null } = {}) {
		const spec = await specById(providerId);
		if (spec === null) return null;
		if (activity !== null) touch(providerId, activity);
		if (spec.adapter === "deepseek-account" && accountClientMetadata(clientMetadata) !== null) return refresh(spec, clientMetadata);
		const hit = cache.get(providerId);
		const at = now();
		if (!force && hit?.configKey === spec.configKey && (!autoRefreshEnabled || policyOf(spec, at).nextRefreshAt > at)) return withHealthAge(hit.account, at);
		return refresh(spec, clientMetadata);
	}
	async function refreshableSpecs() {
		const all = await specs();
		return (await Promise.all(all.map(async (spec) => ({
			spec,
			probe: spec.adapter === null ? await resolveCredential(credentials, spec.apiKeyRef) !== "" : true
		})))).filter((entry) => entry.probe && entry.spec.adapter !== "deepseek-account").map((entry) => entry.spec);
	}
	async function refreshAll() {
		return Promise.all((await refreshableSpecs()).map((spec) => refresh(spec)));
	}
	async function refreshDue({ force = false } = {}) {
		if (!autoRefreshEnabled && !force) return [];
		const at = now();
		const all = await refreshableSpecs();
		const due = force ? all : all.filter((spec) => policyOf(spec, at).nextRefreshAt <= at);
		return Promise.all(due.map((spec) => refresh(spec)));
	}
	async function nextRefreshAt() {
		if (!autoRefreshEnabled) return null;
		const at = now();
		const all = await refreshableSpecs();
		if (all.length === 0) return null;
		return Math.min(...all.map((spec) => policyOf(spec, at).nextRefreshAt));
	}
	async function providerViews() {
		return Promise.all((await specs()).map(async (spec) => {
			const hit = cache.get(spec.id);
			let account = withHealthAge(hit?.configKey === spec.configKey ? hit.account : void 0, now());
			let credentialConfigured = account === void 0 && spec.adapter !== "codearts-credits" && spec.apiKeyRef !== void 0 ? (await resolveAccountCredential(spec, credentials)).value !== "" : false;
			let discoveredStatus = account?.status ?? "pending";
			if (spec.adapter === "ark-coding-plan-cli") credentialConfigured = Boolean(spec.monitor.arkCLIExecutable && spec.monitor.arkCLIProfile);
			if (spec.adapter === "deepseek-account") try {
				const service = hostService(deps, "deepseekAccount");
				credentialConfigured = (await service?.getState())?.status === "credential-stored";
				if (!credentialConfigured || ["signed-out", "unsupported"].includes(account?.status)) {
					account = void 0;
					cache.delete(spec.id);
				}
				discoveredStatus = service === null ? "unsupported" : credentialConfigured ? account?.status ?? "pending" : "signed-out";
			} catch {
				account = void 0;
				cache.delete(spec.id);
				credentialConfigured = false;
				discoveredStatus = "unavailable";
			}
			return {
				id: spec.id,
				displayName: spec.displayName,
				accountMode: account?.mode ?? spec.mode,
				adapter: spec.adapter ?? account?.adapter ?? null,
				configured: account === void 0 ? credentialConfigured : !["not-configured", "signed-out"].includes(account.status),
				status: discoveredStatus,
				fetchedAt: account?.fetchedAt ?? null,
				stale: account?.stale ?? false,
				lastAttemptAt: account?.lastAttemptAt ?? null,
				lastSuccessAt: account?.lastSuccessAt ?? null,
				ageMs: account?.ageMs ?? null,
				provenance: account?.provenance ?? accountProvenance(spec),
				reason: account?.reason ?? null,
				alert: account?.alert ?? null
			};
		}));
	}
	async function subscriptionAccounts() {
		const all = await specs();
		return (await Promise.all(all.filter((spec) => spec.mode === "subscription" || spec.adapter === "sub2api").map((spec) => get(spec.id)))).filter((account) => account?.mode === "subscription");
	}
	return {
		get,
		invalidateQuota: () => {
			for (const [id, hit] of cache) if (hit.account.adapter === "quota-source") cache.delete(id);
			for (const [id, entry] of inflight) if (entry.adapter === "quota-source") refreshGenerations.set(id, (refreshGenerations.get(id) ?? 0) + 1);
			notifyPolicyChange();
		},
		refreshAll,
		refreshDue,
		nextRefreshAt,
		touch,
		setActiveProviders,
		subscribePolicyChanges,
		providerViews,
		subscriptionAccounts,
		validate: async () => {
			await specs();
		},
		cached: (providerId) => withHealthAge(cache.get(providerId)?.account ?? null, now())
	};
}
const ACCOUNT_REFRESH_MS = DEFAULT_REFRESH_MS;
export { ACCOUNT_REFRESH_MS, accountProvenance, createAccountService, isPrivateAddress, jsonPointer, queryAccount, refreshPolicy, resolveAccountSpec, selectResolvedAddress, selectResolvedAddresses, validateAccountConfig, withHealthAge };

//# sourceMappingURL=accounts.js.map