import { failureDetails } from "./account-types.js";
import { homedir } from "node:os";
import { join } from "node:path";
import { readFile } from "node:fs/promises";
// src/subscriptions.ts
/**
* Subscription-quota module for providers that expose percentage windows.
*
* The external interface is deliberately small: callers provide the Harness
* credentials seam and optional transport/time dependencies, and receive two
* normalized provider records. Provider credentials, upstream response shapes,
* parsing quirks, and error mapping remain inside this module.
*
* OpenCode Go's documented provider API does not include usage, but its
* first-party client currently exposes an undocumented Bearer-key endpoint.
* The adapter prefers that simpler path, can reuse OpenCode's local auth.json,
* and keeps the authenticated workspace dashboard as a compatibility fallback.
* Z.ai uses its Coding Plan quota endpoints with a normal API key.
*
* Command Code (Go / GOAT / Pro / Max) exposes the account surface its own CLI
* reads under `/alpha/*` on the API root, one level above the chat base: the
* credit balance, the 5-hour/weekly throttling windows, and the subscription
* plan behind them. None of those paths are documented, so the adapter reads
* every field defensively and a missing endpoint only costs facts, never the
* whole card.
*
* @module dsh-usage-stats/subscriptions
*/
const OPENCODE_GO_URL = "https://opencode.ai";
const OPENCODE_GO_USAGE_URLS = [`${OPENCODE_GO_URL}/inference/go/v1/usage`, `${OPENCODE_GO_URL}/zen/go/v1/usage`];
const ZAI_HOSTS = {
	global: "https://api.z.ai",
	"bigmodel-cn": "https://open.bigmodel.cn"
};
const ZAI_QUOTA_PATH = "/api/monitor/usage/quota/limit";
const ZAI_SUBSCRIPTION_PATH = "/api/biz/subscription/list";
const KIMI_USAGE_URL = "https://api.kimi.com/coding/v1/usages";
const MINIMAX_TOKEN_PLAN_HOSTS = {
	global: "https://www.minimax.io",
	cn: "https://www.minimaxi.com"
};
const MINIMAX_LEGACY_HOSTS = {
	global: "https://api.minimax.io",
	cn: "https://api.minimaxi.com"
};
const MINIMAX_USAGE_PATH = "/v1/api/openplatform/coding_plan/remains";
const MINIMAX_TOKEN_PLAN_PATH = "/v1/token_plan/remains";
const OLLAMA_USAGE_URL = "https://ollama.com/api/usage";
const COMMAND_CODE_API_ROOT = "https://api.commandcode.ai";
const COMMAND_CODE_CREDITS_PATH = "/alpha/billing/credits";
const COMMAND_CODE_USAGE_PATH = "/alpha/usage/summary";
const COMMAND_CODE_SUBSCRIPTION_PATH = "/alpha/billing/subscriptions";
/**
* The client version this adapter claims when it reads Command Code's account
* surface, and the value `commandCodeVersion` overrides per monitor.
*
* Those endpoints are undocumented and unversioned, and the service can gate
* requests by client version, so this fact ages: bump it when this plugin
* releases. The value below is the one this adapter was last verified against
* on the live account surface (2026-10-01); a deployment whose service asks
* for a newer client can set `commandCodeVersion` without waiting for a
* release. Nothing here reads npm at request time — the adapter never adds a
* second remote origin or failure mode to account monitoring.
*/
const COMMAND_CODE_DEFAULT_VERSION = "1.72.1";
/** The shape a claimed client version must have: dotted digits, optional build. */
const COMMAND_CODE_VERSION_PATTERN = /^\d+(?:\.\d+){1,3}(?:[-+][0-9A-Za-z.-]+)?$/;
/** True when `value` is a non-empty client version string the header accepts. */
function isCommandCodeVersion(value) {
	return typeof value === "string" && COMMAND_CODE_VERSION_PATTERN.test(value.trim());
}
/** The claimed client version when a monitor states none (for docs and tests). */
const commandCodeDefaultVersion = COMMAND_CODE_DEFAULT_VERSION;
const DEFAULT_TIMEOUT_MS = 15e3;
const REFS = {
	openCodeApiKey: "OPENCODE_API_KEY",
	openCodeLegacyApiKey: "OPENCODE_GO_API_KEY",
	openCodeCookie: "OPENCODE_GO_AUTH_COOKIE",
	openCodeWorkspace: "OPENCODE_GO_WORKSPACE_ID",
	zaiApiKey: "ZAI_API_KEY",
	zaiRegion: "ZAI_API_REGION",
	kimiApiKey: "KIMI_API_KEY",
	minimaxApiKey: "MINIMAX_API_KEY",
	minimaxRegion: "MINIMAX_API_REGION",
	ollamaApiKey: "OLLAMA_API_KEY",
	commandCodeApiKey: "COMMANDCODE_API_KEY"
};
function numberOrNull(value) {
	if (typeof value === "number" && Number.isFinite(value)) return value;
	if (typeof value === "string" && value.trim() !== "") {
		const parsed = Number(value);
		if (Number.isFinite(parsed)) return parsed;
	}
	return null;
}
function clampPercent(value) {
	const parsed = numberOrNull(value);
	return parsed === null ? null : Math.max(0, Math.min(100, parsed));
}
function round1(value) {
	return Math.round(value * 10) / 10;
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
async function resolveCredential(credentials, ref) {
	if (credentials === void 0 || credentials === null || typeof credentials.resolve !== "function") return "";
	try {
		const hit = await credentials.resolve(ref);
		return typeof hit?.value === "string" ? hit.value.trim() : "";
	} catch {
		return "";
	}
}
function normalizedStatus(error) {
	if (failureDetails(error).name === "TimeoutError" || failureDetails(error).name === "AbortError") return "unavailable";
	if (failureDetails(error).providerStatus) return failureDetails(error).providerStatus;
	return error instanceof SyntaxError ? "invalid-response" : "unavailable";
}
function invalidResponse(message) {
	const error = new Error(message);
	failureDetails(error).providerStatus = "invalid-response";
	return error;
}
async function request(url, init, deps, type) {
	const response = await (deps.fetch ?? fetch)(url, {
		...init,
		signal: AbortSignal.timeout(deps.timeoutMs ?? DEFAULT_TIMEOUT_MS)
	});
	if (!response.ok) {
		const error = /* @__PURE__ */ new Error(`upstream returned HTTP ${response.status}`);
		failureDetails(error).httpStatus = response.status;
		failureDetails(error).providerStatus = response.status === 401 || response.status === 403 ? "unauthorized" : response.status === 429 ? "rate-limited" : "unavailable";
		throw error;
	}
	if (type === "text") return response.text();
	try {
		return await response.json();
	} catch {
		throw invalidResponse("upstream returned invalid JSON");
	}
}
function sanitizeCookie(raw) {
	let value = String(raw ?? "").trim().replace(/^cookie\s*:\s*/i, "");
	value = value.split(";").map((part) => part.trim()).filter((window) => Boolean(window)).join("; ");
	return value !== "" && !value.includes("=") ? `auth=${value}` : value;
}
function workspaceIdOf(raw) {
	return String(raw ?? "").match(/wrk_[A-Za-z0-9]+/)?.[0] ?? "";
}
function looksSignedOut(text) {
	const lower = String(text).toLowerCase();
	return lower.includes("sign in") || lower.includes("login") || lower.includes("auth/authorize") || lower.includes("actor of type \"public\"");
}
function goWindowFromObject(value, kind, now) {
	if (value === null || typeof value !== "object") return null;
	const percentSource = value.usagePercent ?? value.usedPercent ?? value.percentUsed ?? value.percentage ?? value.percent;
	let usedPercent = clampPercent(percentSource);
	if (usedPercent === null) {
		const used = numberOrNull(value.used ?? value.consumed);
		const limit = numberOrNull(value.limit ?? value.total ?? value.quota);
		if (used !== null && limit !== null && limit > 0) usedPercent = clampPercent(used / limit * 100);
	}
	if (usedPercent === null) return null;
	if (usedPercent <= 1 && usedPercent >= 0 && value.percent === void 0 && percentSource !== void 0) usedPercent *= 100;
	const resetSeconds = numberOrNull(value.resetInSec ?? value.resetInSeconds ?? value.resetSeconds);
	const resetsAt = resetSeconds === null ? toIso(value.resetAt ?? value.resetsAt ?? value.nextReset) : new Date(now + Math.max(0, resetSeconds) * 1e3).toISOString();
	return {
		kind,
		usedPercent: round1(clampPercent(usedPercent)),
		remainingPercent: round1(100 - clampPercent(usedPercent)),
		...resetsAt === null ? {} : { resetsAt }
	};
}
function parseOpenCodeGoApi(raw, now) {
	const body = raw;
	const usage = body?.usage ?? body;
	if (usage === null || typeof usage !== "object") return [];
	return [
		goWindowFromObject(usage.rolling, "session", now),
		goWindowFromObject(usage.weekly, "weekly", now),
		goWindowFromObject(usage.monthly, "monthly", now)
	].filter((window) => Boolean(window));
}
function findObject(root, keyword, depth = 0) {
	if (root === null || typeof root !== "object" || depth > 5) return null;
	for (const [key, value] of Object.entries(root)) if (key.toLowerCase().includes(keyword) && value !== null && typeof value === "object") return value;
	for (const value of Object.values(root)) {
		const found = findObject(value, keyword, depth + 1);
		if (found !== null) return found;
	}
	return null;
}
function goWindowFromText(text, key, kind, now) {
	const percent = new RegExp(`${key}[^}]*?usagePercent\\s*[:=]\\s*([0-9]+(?:\\.[0-9]+)?)`, "i").exec(text);
	if (percent === null) return null;
	const reset = new RegExp(`${key}[^}]*?resetInSec\\s*[:=]\\s*([0-9]+)`, "i").exec(text);
	const usedPercent = round1(clampPercent(Number(percent[1])));
	return {
		kind,
		usedPercent,
		remainingPercent: round1(100 - usedPercent),
		...reset === null ? {} : { resetsAt: new Date(now + Number(reset[1]) * 1e3).toISOString() }
	};
}
function parseOpenCodeGo(text, now) {
	let windows = [];
	try {
		const root = JSON.parse(text);
		windows = [
			goWindowFromObject(findObject(root, "rolling"), "session", now),
			goWindowFromObject(findObject(root, "weekly") ?? findObject(root, "week"), "weekly", now),
			goWindowFromObject(findObject(root, "monthly") ?? findObject(root, "month"), "monthly", now)
		].filter((window) => Boolean(window));
	} catch {}
	if (!windows.some((window) => window.kind === "session") || !windows.some((window) => window.kind === "weekly")) windows = [
		goWindowFromText(text, "rollingUsage", "session", now),
		goWindowFromText(text, "weeklyUsage", "weekly", now),
		goWindowFromText(text, "monthlyUsage", "monthly", now)
	].filter((window) => Boolean(window));
	return windows.some((window) => window.kind === "session") && windows.some((window) => window.kind === "weekly") ? windows : [];
}
async function localOpenCodeApiKey(deps) {
	try {
		const home = typeof deps.homedir === "function" ? deps.homedir() : homedir();
		const load = deps.readFile ?? readFile;
		const raw = JSON.parse(await load(join(home, ".local", "share", "opencode", "auth.json"), "utf8"));
		const entry = raw?.["opencode-go"] ?? raw?.opencode;
		return entry?.type === "api" && typeof entry.key === "string" ? entry.key.trim() : "";
	} catch {
		return "";
	}
}
async function collectOpenCodeGoFromDashboard(cookie, workspaceId, deps) {
	try {
		const text = await request(`${OPENCODE_GO_URL}/workspace/${workspaceId}/go`, { headers: {
			cookie,
			accept: "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8"
		} }, deps, "text");
		if (looksSignedOut(text)) return {
			status: "unauthorized",
			windows: []
		};
		const windows = parseOpenCodeGo(text, deps.now());
		return {
			status: windows.length > 0 ? "ok" : "invalid-response",
			windows
		};
	} catch (error) {
		return {
			status: normalizedStatus(error),
			windows: []
		};
	}
}
async function collectOpenCodeGo(credentials, deps) {
	const apiKeyRef = deps.apiKeyRef ?? REFS.openCodeApiKey;
	const allowLocalAuth = deps.allowLocalAuth ?? deps.apiKeyRef === void 0;
	let configuredApiKey = await resolveCredential(credentials, apiKeyRef);
	if (configuredApiKey === "" && deps.apiKeyRef === void 0) configuredApiKey = await resolveCredential(credentials, REFS.openCodeLegacyApiKey);
	const [cookieRaw, workspaceRaw] = allowLocalAuth ? await Promise.all([resolveCredential(credentials, REFS.openCodeCookie), resolveCredential(credentials, REFS.openCodeWorkspace)]) : ["", ""];
	const apiKey = configuredApiKey || (allowLocalAuth ? await localOpenCodeApiKey(deps) : "");
	const cookie = sanitizeCookie(cookieRaw);
	const workspaceId = workspaceIdOf(workspaceRaw);
	if (apiKey === "" && (cookie === "" || workspaceId === "")) return {
		id: "opencode-go",
		displayName: "OpenCode Go",
		mode: "subscription",
		status: "not-configured",
		plan: "Go",
		missingCredentials: [apiKeyRef],
		windows: []
	};
	let apiStatus = "unavailable";
	if (apiKey !== "") for (const url of OPENCODE_GO_USAGE_URLS) try {
		const windows = parseOpenCodeGoApi(await request(url, { headers: {
			authorization: `Bearer ${apiKey}`,
			accept: "application/json"
		} }, deps, "json"), deps.now());
		if (windows.length > 0) return {
			id: "opencode-go",
			displayName: "OpenCode Go",
			mode: "subscription",
			status: "ok",
			plan: "Go",
			windows
		};
		apiStatus = "invalid-response";
		break;
	} catch (error) {
		apiStatus = normalizedStatus(error);
		if (failureDetails(error).httpStatus !== 404 && failureDetails(error).httpStatus !== 405) break;
	}
	if (apiKey === "" && cookie !== "" && workspaceId !== "") {
		const dashboard = await collectOpenCodeGoFromDashboard(cookie, workspaceId, deps);
		return {
			id: "opencode-go",
			displayName: "OpenCode Go",
			mode: "subscription",
			status: dashboard.status,
			plan: "Go",
			windows: dashboard.windows
		};
	}
	return {
		id: "opencode-go",
		displayName: "OpenCode Go",
		mode: "subscription",
		status: apiStatus,
		plan: "Go",
		windows: []
	};
}
function zaiRegionOf(raw, fallback = "global") {
	const value = String(raw || fallback).trim().toLowerCase();
	return value === "bigmodel-cn" || value === "cn" || value.includes("bigmodel.cn") ? "bigmodel-cn" : "global";
}
function zaiWindowMinutes(limit) {
	const unit = numberOrNull(limit?.unit);
	const number = numberOrNull(limit?.number);
	if (unit === null || number === null || number <= 0) return null;
	if (unit === 5) return number;
	if (unit === 3) return number * 60;
	if (unit === 1) return number * 24 * 60;
	if (unit === 6) return number * 7 * 24 * 60;
	return null;
}
function zaiUsedPercent(limit) {
	const total = numberOrNull(limit?.usage);
	const remaining = numberOrNull(limit?.remaining);
	const current = numberOrNull(limit?.currentValue ?? limit?.current_value);
	if (total !== null && total > 0) {
		const used = remaining === null ? current : current === null ? total - remaining : Math.max(total - remaining, current);
		if (used !== null) return clampPercent(Math.max(0, Math.min(total, used)) / total * 100);
	}
	return clampPercent(limit?.percentage ?? limit?.usedPercent ?? limit?.used_percent);
}
function displayPlan(value) {
	return String(value ?? "").trim().replace(/[_-]+/g, " ").replace(/\s+/g, " ").replace(/\bglm\b/gi, "GLM").replace(/\b\w/g, (char) => char.toUpperCase());
}
function zaiPlan(quota, subscription) {
	const row = Array.isArray(subscription?.data) ? subscription.data.find((entry) => entry && typeof entry === "object") : null;
	for (const source of [row, quota?.data]) for (const key of [
		"product_name",
		"productName",
		"plan_name",
		"planName",
		"package_name",
		"packageName",
		"plan_type",
		"planType",
		"level"
	]) {
		const value = displayPlan(source?.[key]);
		if (value !== "") return value;
	}
	return "GLM Coding Plan";
}
function zaiWindow(limit, kind, fallbackReset = null) {
	const usedPercent = zaiUsedPercent(limit);
	if (usedPercent === null) return null;
	const resetsAt = toIso(limit.nextResetTime ?? limit.next_reset_time) ?? fallbackReset;
	return {
		kind,
		usedPercent: round1(usedPercent),
		remainingPercent: round1(100 - usedPercent),
		...resetsAt === null ? {} : { resetsAt },
		...numberOrNull(limit.remaining) === null ? {} : { remaining: numberOrNull(limit.remaining) }
	};
}
function parseZai(rawQuota, rawSubscription) {
	const quota = rawQuota;
	const subscription = rawSubscription;
	const limits = Array.isArray(quota?.data?.limits) ? quota.data.limits : [];
	const tokenLimits = limits.filter((limit) => ["TOKENS_LIMIT", "CREDIT_LIMIT"].includes(String(limit?.type ?? limit?.limit_type ?? "").toUpperCase()) && zaiUsedPercent(limit) !== null).sort((a, b) => (zaiWindowMinutes(a) ?? Number.MAX_SAFE_INTEGER) - (zaiWindowMinutes(b) ?? Number.MAX_SAFE_INTEGER));
	const timeLimit = limits.find((limit) => String(limit?.type ?? limit?.limit_type ?? "").toUpperCase() === "TIME_LIMIT" && zaiUsedPercent(limit) !== null) ?? null;
	const first = tokenLimits[0] ?? null;
	const session = tokenLimits.length >= 2 ? first : zaiWindowMinutes(first) !== null && zaiWindowMinutes(first) <= 360 ? first : null;
	const weekly = tokenLimits.length >= 2 ? tokenLimits[tokenLimits.length - 1] : session === null ? first : null;
	const subscriptionRow = Array.isArray(subscription?.data) ? subscription.data[0] : null;
	const renewAt = toIso(subscriptionRow?.next_renew_time ?? subscriptionRow?.nextRenewTime);
	return {
		plan: zaiPlan(quota, subscription),
		windows: [
			session === null ? null : zaiWindow(session, "session"),
			weekly === null ? null : zaiWindow(weekly, "weekly"),
			timeLimit === null ? null : zaiWindow(timeLimit, "billing", renewAt)
		].filter((window) => Boolean(window))
	};
}
async function collectZai(credentials, deps) {
	const apiKeyRef = deps.zaiApiKeyRef ?? REFS.zaiApiKey;
	const [apiKey, configuredRegion] = await Promise.all([resolveCredential(credentials, apiKeyRef), resolveCredential(credentials, REFS.zaiRegion)]);
	const region = zaiRegionOf(deps.zaiRegionOverride ?? configuredRegion, deps.zaiDefaultRegion);
	if (apiKey === "") return {
		id: "zai",
		displayName: "Z.ai",
		mode: "subscription",
		status: "not-configured",
		plan: "GLM Coding Plan",
		region,
		missingCredentials: [apiKeyRef],
		windows: []
	};
	const host = ZAI_HOSTS[region];
	const init = { headers: {
		authorization: apiKey,
		accept: "application/json"
	} };
	try {
		const quota = await request(`${host}${ZAI_QUOTA_PATH}`, init, deps, "json");
		let subscription = null;
		try {
			subscription = await request(`${host}${ZAI_SUBSCRIPTION_PATH}`, init, deps, "json");
		} catch {}
		const parsed = parseZai(quota, subscription);
		return {
			id: "zai",
			displayName: "Z.ai",
			mode: "subscription",
			status: parsed.windows.length > 0 ? "ok" : "invalid-response",
			plan: parsed.plan,
			region,
			windows: parsed.windows
		};
	} catch (error) {
		return {
			id: "zai",
			displayName: "Z.ai",
			mode: "subscription",
			status: normalizedStatus(error),
			plan: "GLM Coding Plan",
			region,
			windows: []
		};
	}
}
function limitWindow(value, kind) {
	if (value === null || typeof value !== "object") return null;
	const limit = numberOrNull(value.limit ?? value.total);
	const remaining = numberOrNull(value.remaining);
	if (limit === null || remaining === null || limit <= 0) return null;
	const usedPercent = round1(clampPercent((limit - remaining) / limit * 100));
	const resetsAt = toIso(value.resetTime ?? value.reset_time ?? value.resetsAt);
	return {
		kind,
		usedPercent,
		remainingPercent: round1(100 - usedPercent),
		...resetsAt === null ? {} : { resetsAt }
	};
}
function parseKimi(raw) {
	const body = raw;
	const data = body?.data ?? body;
	const session = (Array.isArray(data?.limits) ? data.limits : []).map((entry) => limitWindow(entry?.detail ?? entry, "session")).find(Boolean) ?? null;
	const weekly = limitWindow(data?.usage, "weekly");
	return {
		plan: String(data?.plan ?? data?.planName ?? "Kimi For Coding"),
		windows: [session, weekly].filter((window) => Boolean(window))
	};
}
async function collectKimi(credentials, deps) {
	const apiKeyRef = deps.apiKeyRef ?? REFS.kimiApiKey;
	const apiKey = await resolveCredential(credentials, apiKeyRef);
	if (apiKey === "") return {
		id: "kimi",
		displayName: "Kimi For Coding",
		mode: "subscription",
		status: "not-configured",
		plan: "Kimi For Coding",
		missingCredentials: [apiKeyRef],
		windows: []
	};
	try {
		const parsed = parseKimi(await request(nonEmptyUrl(deps.baseURL, "/coding/v1/usages") ?? KIMI_USAGE_URL, { headers: {
			authorization: `Bearer ${apiKey}`,
			accept: "application/json"
		} }, deps, "json"));
		return {
			id: "kimi",
			displayName: "Kimi For Coding",
			mode: "subscription",
			status: parsed.windows.length > 0 ? "ok" : "invalid-response",
			...parsed
		};
	} catch (error) {
		return {
			id: "kimi",
			displayName: "Kimi For Coding",
			mode: "subscription",
			status: normalizedStatus(error),
			plan: "Kimi For Coding",
			windows: []
		};
	}
}
function nonEmptyUrl(value, defaultPath) {
	if (typeof value !== "string" || value.trim() === "") return null;
	try {
		const url = new URL(value);
		return url.pathname === "/" || url.pathname === "" ? new URL(defaultPath, url).href : url.href;
	} catch {
		return null;
	}
}
function minimaxRegionOf(raw, baseURL) {
	const value = String(raw ?? "").trim().toLowerCase();
	if (value === "cn" || value.includes("minimaxi.com") || String(baseURL ?? "").includes("minimaxi.com")) return "cn";
	return "global";
}
function minimaxRegionIsUndeclared(raw, baseURL) {
	return raw === void 0 || raw === null || String(raw).trim() === "";
}
function resetFromDuration(value, now) {
	const milliseconds = numberOrNull(value);
	if (milliseconds === null || milliseconds < 0) return null;
	const date = new Date(now + milliseconds);
	return Number.isNaN(date.getTime()) ? null : date.toISOString();
}
const MINIMAX_CHAT_MODEL_PATTERN = /^(minimax-m|coding-plan)/i;
const MINIMAX_CREDENTIAL_STATUS_CODES = /* @__PURE__ */ new Set([1004, 2049]);
function minimaxChatEntry(remains) {
	const named = remains.find((entry) => String(entry?.model_name ?? entry?.modelName ?? "").toLowerCase() === "general");
	if (named !== void 0) return named;
	return remains.find((entry) => MINIMAX_CHAT_MODEL_PATTERN.test(String(entry?.model_name ?? entry?.modelName ?? "")));
}
function minimaxWindowRemaining(remainingPercent, totalCount, usageCount, status) {
	const remaining = clampPercent(remainingPercent);
	if (remaining !== null) return remaining;
	const total = numberOrNull(totalCount);
	const usage = numberOrNull(usageCount);
	if (total !== null && total > 0 && usage !== null) return clampPercent((1 - usage / total) * 100);
	if (status === 2) return 0;
	if (status === 3) return 100;
	return null;
}
function parseMiniMax(raw, now) {
	const body = raw;
	const statusCode = numberOrNull(body?.base_resp?.status_code ?? body?.baseResp?.statusCode);
	if (statusCode !== null && statusCode !== 0) {
		const message = body?.base_resp?.status_msg ?? body?.baseResp?.statusMsg;
		return {
			windows: [],
			reason: `base_resp status_code ${statusCode}${typeof message === "string" && message.trim() !== "" ? `: ${message.trim()}` : ""}`,
			credentialRejected: MINIMAX_CREDENTIAL_STATUS_CODES.has(statusCode)
		};
	}
	const remains = Array.isArray(body?.model_remains) ? body.model_remains : Array.isArray(body?.data?.model_remains) ? body.data.model_remains : [];
	if (remains.length === 0) return {
		windows: [],
		reason: "response has no model_remains entries"
	};
	const general = minimaxChatEntry(remains);
	if (general === void 0) return {
		windows: [],
		reason: "model_remains has no general/chat-model entry"
	};
	const intervalRemaining = minimaxWindowRemaining(general.current_interval_remaining_percent ?? general.currentIntervalRemainingPercent, general.current_interval_total_count ?? general.currentIntervalTotalCount, general.current_interval_usage_count ?? general.currentIntervalUsageCount, numberOrNull(general.current_interval_status ?? general.currentIntervalStatus));
	const weeklyRemaining = minimaxWindowRemaining(general.current_weekly_remaining_percent ?? general.currentWeeklyRemainingPercent, general.current_weekly_total_count ?? general.currentWeeklyTotalCount, general.current_weekly_usage_count ?? general.currentWeeklyUsageCount, numberOrNull(general.current_weekly_status ?? general.currentWeeklyStatus));
	const sessionReset = toIso(general.current_interval_end_time ?? general.currentIntervalEndTime ?? general.current_interval_reset_time) ?? resetFromDuration(general.remains_time ?? general.remainsTime, now);
	const weeklyReset = toIso(general.current_weekly_end_time ?? general.currentWeeklyEndTime ?? general.current_weekly_reset_time) ?? resetFromDuration(general.weekly_remains_time ?? general.weeklyRemainsTime, now);
	const windows = [intervalRemaining === null ? null : {
		kind: "session",
		usedPercent: round1(100 - intervalRemaining),
		remainingPercent: round1(intervalRemaining),
		...sessionReset === null ? {} : { resetsAt: sessionReset }
	}, weeklyRemaining === null ? null : {
		kind: "weekly",
		usedPercent: round1(100 - weeklyRemaining),
		remainingPercent: round1(weeklyRemaining),
		...weeklyReset === null ? {} : { resetsAt: weeklyReset }
	}].filter((window) => Boolean(window));
	return {
		windows,
		reason: windows.length === 0 ? "chat-model entry has no usable quota fields" : null
	};
}
function minimaxUrls(region) {
	return [
		`${MINIMAX_TOKEN_PLAN_HOSTS[region]}${MINIMAX_TOKEN_PLAN_PATH}`,
		`${MINIMAX_LEGACY_HOSTS[region]}${MINIMAX_TOKEN_PLAN_PATH}`,
		`${MINIMAX_LEGACY_HOSTS[region]}${MINIMAX_USAGE_PATH}`
	];
}
async function fetchMiniMaxBody(urls, apiKey, deps) {
	let body = null;
	for (const [index, url] of urls.entries()) try {
		body = await request(url, { headers: {
			authorization: `Bearer ${apiKey}`,
			accept: "application/json"
		} }, deps, "json");
		break;
	} catch (error) {
		const tryNext = failureDetails(error).httpStatus === 404 || failureDetails(error).httpStatus === 405 || failureDetails(error).providerStatus === "invalid-response";
		if (index < urls.length - 1 && tryNext) continue;
		throw error;
	}
	return body;
}
async function collectMiniMax(credentials, deps) {
	const apiKeyRef = deps.apiKeyRef ?? REFS.minimaxApiKey;
	const [apiKey, configuredRegion] = await Promise.all([resolveCredential(credentials, apiKeyRef), resolveCredential(credentials, REFS.minimaxRegion)]);
	const regionHint = [
		deps.region,
		configuredRegion,
		deps.inferredRegion
	].find((value) => typeof value === "string" && value.trim() !== "");
	const region = minimaxRegionOf(regionHint, deps.baseURL);
	if (apiKey === "") return {
		id: "minimax",
		displayName: "MiniMax Coding Plan",
		mode: "subscription",
		status: "not-configured",
		plan: "MiniMax Coding Plan",
		region,
		missingCredentials: [apiKeyRef],
		windows: []
	};
	const configuredUrl = nonEmptyUrl(deps.baseURL, MINIMAX_USAGE_PATH);
	const regionDeclared = !minimaxRegionIsUndeclared(regionHint, deps.baseURL);
	const regions = configuredUrl === null && !regionDeclared ? [region, region === "cn" ? "global" : "cn"] : [region];
	const urlsFor = (candidateRegion) => configuredUrl === null ? minimaxUrls(candidateRegion) : [configuredUrl];
	try {
		let last = null;
		for (const candidateRegion of regions) {
			const parsed = parseMiniMax(await fetchMiniMaxBody(urlsFor(candidateRegion), apiKey, deps), deps.now());
			if (parsed.credentialRejected !== true || regionDeclared || regions.length === 1) return {
				id: "minimax",
				displayName: "MiniMax Coding Plan",
				mode: "subscription",
				status: parsed.windows.length > 0 ? "ok" : parsed.credentialRejected === true ? "unauthorized" : "invalid-response",
				plan: "MiniMax Coding Plan",
				region: candidateRegion,
				windows: parsed.windows,
				...parsed.windows.length > 0 || parsed.reason === null ? {} : { reason: parsed.reason }
			};
			last = {
				region: candidateRegion,
				parsed
			};
		}
		return {
			id: "minimax",
			displayName: "MiniMax Coding Plan",
			mode: "subscription",
			status: "unauthorized",
			plan: "MiniMax Coding Plan",
			region: last.region,
			windows: [],
			...last.parsed.reason === null ? {} : { reason: last.parsed.reason }
		};
	} catch (error) {
		return {
			id: "minimax",
			displayName: "MiniMax Coding Plan",
			mode: "subscription",
			status: normalizedStatus(error),
			plan: "MiniMax Coding Plan",
			region,
			windows: []
		};
	}
}
/**
* Ollama Cloud usage monitor.
*
* Ollama's cloud /api/usage endpoint reports consumed usage ratios for two
* limit windows (a 5-hour session window and a weekly window), plus an
* activity cost. There is no monetary balance, so this adapter presents the
* two windows as subscription-style progress bars, mirroring OpenCode Go.
*/
function ollamaWindowFromObject(limit, kind) {
	if (limit === null || typeof limit !== "object") return null;
	const ratio = numberOrNull(limit.usage);
	if (ratio === null) return null;
	const usedPercent = round1(clampPercent(ratio * 100));
	return {
		kind,
		usedPercent,
		remainingPercent: round1(100 - usedPercent)
	};
}
function parseOllama(raw) {
	const limits = raw?.limits;
	if (limits === null || typeof limits !== "object") return [];
	return [ollamaWindowFromObject(limits.session, "session"), ollamaWindowFromObject(limits.weekly, "weekly")].filter((window) => Boolean(window));
}
async function collectOllama(credentials, deps) {
	const apiKeyRef = deps.apiKeyRef ?? REFS.ollamaApiKey;
	const apiKey = await resolveCredential(credentials, apiKeyRef);
	if (apiKey === "") return {
		id: "ollama",
		displayName: "Ollama",
		mode: "subscription",
		status: "not-configured",
		plan: "Ollama",
		missingCredentials: [apiKeyRef],
		windows: []
	};
	try {
		const windows = parseOllama(await request(nonEmptyUrl(deps.baseURL, "/api/usage") ?? OLLAMA_USAGE_URL, { headers: {
			authorization: `Bearer ${apiKey}`,
			accept: "application/json"
		} }, deps, "json"));
		return {
			id: "ollama",
			displayName: "Ollama",
			mode: "subscription",
			status: windows.length > 0 ? "ok" : "invalid-response",
			plan: "Ollama",
			windows
		};
	} catch (error) {
		return {
			id: "ollama",
			displayName: "Ollama",
			mode: "subscription",
			status: normalizedStatus(error),
			plan: "Ollama",
			windows: []
		};
	}
}
/**
* Command Code (Go / GOAT / Pro / Max).
*
* Chat runs on `{root}/provider/v1`, but the account surface the vendor's own
* CLI reads sits on the API root:
*
*   GET /alpha/billing/credits         credit balance + 5-hour/weekly windows
*   GET /alpha/usage/summary           request/cost/token totals for the period
*   GET /alpha/billing/subscriptions   the plan behind the credits
*
* None of those paths are documented, so each fact is optional: only the
* credits call can end the query, and the other two merely decide how much
* detail the card carries. The rolling windows are money caps, so their dollars
* become percentages exactly like every other token-plan adapter, while the
* credit pool stays a monetary balance the way a balance-mode provider shows it.
*/
const COMMAND_CODE_PLAN_NAMES = Object.freeze([
	["individual-go", "Go"],
	["individual-goat", "GOAT"],
	["individual-pro-v1", "Pro"],
	["individual-pro", "Pro"],
	["individual-provider", "Provider"],
	["individual-max", "Max"],
	["individual-ultra", "Ultra"],
	["teams-pro", "Teams Pro"]
]);
/** Longest prefix first, so `individual-pro-v1` never answers as `individual-pro`. */
const COMMAND_CODE_PLAN_PREFIXES = Object.freeze([...COMMAND_CODE_PLAN_NAMES].sort((left, right) => right[0].length - left[0].length));
function commandCodePlanName(planId) {
	const raw = typeof planId === "string" ? planId.trim() : "";
	if (raw === "") return null;
	const normalized = raw.toLowerCase().replace(/_/g, "-");
	const match = COMMAND_CODE_PLAN_PREFIXES.find(([prefix]) => normalized.startsWith(prefix));
	return match === void 0 ? raw : match[1];
}
/** The account root behind a configured chat base (`…/provider/v1`). */
function commandCodeApiRoot(raw) {
	if (typeof raw !== "string" || raw.trim() === "") return COMMAND_CODE_API_ROOT;
	try {
		const url = new URL(raw.trim());
		url.pathname = url.pathname.replace(/\/+$/, "").replace(/\/provider(?:\/v\d+)?$/i, "");
		url.search = "";
		url.hash = "";
		const href = url.href.replace(/\/+$/, "");
		return href === "" ? COMMAND_CODE_API_ROOT : href;
	} catch {
		return COMMAND_CODE_API_ROOT;
	}
}
function commandCodeHeaders(apiKey, version) {
	return {
		authorization: `Bearer ${apiKey}`,
		accept: "application/json",
		"x-command-code-version": version ?? COMMAND_CODE_DEFAULT_VERSION,
		"x-cli-environment": "production"
	};
}
/** One money-capped rolling window, normalized to a percentage pair. */
function commandCodeWindow(source, kind) {
	if (source === null || typeof source !== "object") return null;
	const cap = numberOrNull(source.cap);
	const used = numberOrNull(source.used);
	if (cap === null || cap <= 0 || used === null) return null;
	const usedPercent = round1(clampPercent(used / cap * 100));
	const resetsAt = toIso(source.resetAt);
	return {
		kind,
		usedPercent,
		remainingPercent: round1(100 - usedPercent),
		...resetsAt === null ? {} : { resetsAt }
	};
}
function commandCodeWindows(body) {
	const limits = body?.windowLimits;
	if (limits === null || typeof limits !== "object" || limits.limited === false) return [];
	return [commandCodeWindow(limits.fiveHour, "session"), commandCodeWindow(limits.weekly, "weekly")].filter((window) => Boolean(window));
}
/**
* The monthly credit pool as a third window, beside the 5-hour and weekly caps.
*
* The pool states its own two numbers: `credits.monthlyCredits` is what REMAINS
* of the plan's monthly allowance, and `usage.totalMonthlyCredits` is what this
* period spent FROM that allowance, so only that pair makes the percentage. The
* summary's other two counters — `totalPurchasedCredits` and `totalFreeCredits`
* — describe separate pools: they belong to the balance breakdown, and letting
* them into this denominator would report a plan as less spent than it is
* whenever either is non-zero (70 left, plus 20 bought and 10 granted, would
* divide a monthly spend of 1 by 101 instead of by 71).
*
* For the same reason a missing `totalMonthlyCredits` leaves the bar out rather
* than borrowing the aggregate `totalCredits`, which counts the other pools.
*/
function commandCodeMonthlyWindow(credits, usage, resetsAt) {
	const remaining = numberOrNull(credits?.monthlyCredits);
	const used = numberOrNull(usage?.totalMonthlyCredits);
	if (remaining === null || used === null) return null;
	const total = remaining + used;
	if (!(total > 0)) return null;
	const usedPercent = round1(clampPercent(used / total * 100));
	return {
		kind: "monthly",
		usedPercent,
		remainingPercent: round1(100 - usedPercent),
		...resetsAt === null ? {} : { resetsAt }
	};
}
/**
* The credit pool as an ordinary balance: `remaining` is every pool at once —
* monthly, bought and granted are all spendable — with the two extras stated
* again in the breakdown. `used`/`total` are the summary's aggregate pair over
* those same pools, so the card's rows keep adding up (`remaining + used =
* total`). The monthly bar is not read from this pair; see above.
*/
function commandCodeCredits(body, usage) {
	const credits = body?.credits;
	if (credits === null || typeof credits !== "object") return null;
	const monthly = numberOrNull(credits.monthlyCredits);
	const purchased = numberOrNull(credits.purchasedCredits);
	const free = numberOrNull(credits.freeCredits);
	if (monthly === null && purchased === null && free === null) return null;
	const remaining = Math.max(0, (monthly ?? 0) + (purchased ?? 0) + (free ?? 0));
	const spent = numberOrNull(usage?.totalCredits);
	return {
		remaining,
		...spent === null ? {} : { used: spent },
		...spent === null ? {} : { total: remaining + spent },
		currency: "USD",
		unlimited: false,
		expiresAt: null,
		available: remaining > 0,
		breakdown: {
			granted: free ?? 0,
			toppedUp: purchased ?? 0
		}
	};
}
async function collectCommandCode(credentials, deps) {
	const apiKeyRef = deps.apiKeyRef ?? REFS.commandCodeApiKey;
	const apiKey = await resolveCredential(credentials, apiKeyRef);
	if (apiKey === "") return {
		id: "commandcode-goat",
		displayName: "Command Code",
		mode: "subscription",
		status: "not-configured",
		missingCredentials: [apiKeyRef],
		windows: []
	};
	const root = commandCodeApiRoot(deps.baseURL);
	const init = { headers: commandCodeHeaders(apiKey, deps.commandCodeVersion) };
	try {
		const credits = await request(`${root}${COMMAND_CODE_CREDITS_PATH}`, init, deps, "json");
		const [usage, subscription] = await Promise.all([request(`${root}${COMMAND_CODE_USAGE_PATH}`, init, deps, "json").catch(() => null), request(`${root}${COMMAND_CODE_SUBSCRIPTION_PATH}`, init, deps, "json").catch(() => null)]);
		const windows = commandCodeWindows(credits);
		const balance = commandCodeCredits(credits, usage);
		const monthly = commandCodeMonthlyWindow(credits?.credits, usage, toIso(subscription?.data?.currentPeriodEnd));
		if (monthly !== null) windows.push(monthly);
		const plan = commandCodePlanName(subscription?.data?.planId ?? credits?.credits?.planId);
		const usable = windows.length > 0 || balance !== null;
		return {
			id: "commandcode-goat",
			displayName: "Command Code",
			mode: "subscription",
			status: usable ? "ok" : "invalid-response",
			...plan === null ? {} : { plan },
			windows,
			...balance === null ? {} : { credits: balance },
			...usable ? {} : { reason: "commandcode-billing-shape-unrecognized" }
		};
	} catch (error) {
		return {
			id: "commandcode-goat",
			displayName: "Command Code",
			mode: "subscription",
			status: normalizedStatus(error),
			windows: []
		};
	}
}
/** Query one subscription/token-plan adapter. */
async function collectSubscription(providerId, credentials, options = {}, deps = {}) {
	const shared = {
		fetch: deps.fetch,
		readFile: deps.readFile,
		homedir: deps.homedir,
		timeoutMs: deps.timeoutMs,
		now: deps.now ?? Date.now,
		apiKeyRef: options.apiKeyRef,
		allowLocalAuth: options.allowLocalAuth,
		baseURL: options.baseURL,
		commandCodeVersion: options.commandCodeVersion,
		inferredRegion: options.inferredRegion,
		region: options.region
	};
	if (providerId === "opencode-go") return collectOpenCodeGo(credentials, shared);
	if (providerId === "zai") return collectZai(credentials, {
		...shared,
		zaiApiKeyRef: options.apiKeyRef,
		zaiRegionOverride: options.zaiRegionOverride,
		zaiDefaultRegion: options.region ?? "global"
	});
	if (providerId === "kimi") return collectKimi(credentials, shared);
	if (providerId === "minimax") return collectMiniMax(credentials, shared);
	if (providerId === "ollama") return collectOllama(credentials, shared);
	if (providerId === "commandcode-goat") return collectCommandCode(credentials, shared);
	return {
		id: providerId,
		displayName: providerId,
		mode: "subscription",
		status: "unavailable",
		windows: []
	};
}
/** Collect every supported subscription provider concurrently. */
async function collectSubscriptions(credentials, options = {}, deps = {}) {
	return Promise.all([collectSubscription("opencode-go", credentials, { apiKeyRef: options.openCodeApiKeyRef }, deps), collectSubscription("zai", credentials, {
		apiKeyRef: options.zaiApiKeyRef,
		region: options.zaiDefaultRegion ?? "global"
	}, deps)]);
}
const subscriptionCredentialRefs = { ...REFS };
export { collectSubscription, collectSubscriptions, commandCodeDefaultVersion, isCommandCodeVersion, subscriptionCredentialRefs, zaiRegionOf };

//# sourceMappingURL=subscriptions.js.map