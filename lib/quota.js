// src/quota.ts
/** Host-only quota-source protocol v1. No credentials or upstream response objects cross this seam. */
const STATUSES = /* @__PURE__ */ new Set([
	"ok",
	"not-configured",
	"unauthorized",
	"rate-limited",
	"unavailable",
	"invalid-response"
]);
const REASONS = /* @__PURE__ */ new Set([
	"reauth-required",
	"credential-conflict",
	"persistence-failed",
	"invalid-auth-file",
	"file-unavailable",
	"refresh-busy",
	"unsupported-auth-mode"
]);
const idOf = (value) => typeof value === "string" && /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(value);
const text = (value) => typeof value === "string" && value.length <= 160 && !/[\r\n\x00-\x1f]/.test(value);
const time = (value) => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= 864e13;
const bindingChanged = () => Object.assign(/* @__PURE__ */ new Error("quota binding changed"), { name: "QuotaBindingChanged" });
async function abortable(operation, signal) {
	let listener;
	try {
		return await Promise.race([operation, new Promise((_, reject) => {
			listener = () => reject(signal.reason ?? /* @__PURE__ */ new Error("quota read aborted"));
			if (signal.aborted) listener();
			else signal.addEventListener("abort", listener, { once: true });
		})]);
	} finally {
		if (listener) signal.removeEventListener("abort", listener);
	}
}
/** Validate and project only public fields; reject malformed facts instead of inventing zero. */
function projectQuotaSnapshot(input) {
	const raw = input;
	if (!raw || !time(raw.observedAt) || !Array.isArray(raw.accounts) || raw.accounts.length > 50) throw new Error("invalid quota snapshot");
	const seen = /* @__PURE__ */ new Set();
	return {
		observedAt: raw.observedAt,
		accounts: raw.accounts.map((account) => {
			if (!account || !idOf(account.id) || seen.has(account.id) || !STATUSES.has(account.status) || !Array.isArray(account.windows) || account.windows.length > 20 || account.status === "ok" && account.windows.length === 0) throw new Error("invalid quota account");
			seen.add(account.id);
			const windows = /* @__PURE__ */ new Set();
			return {
				id: account.id,
				status: account.status,
				...text(account.label) ? { label: account.label } : {},
				...text(account.plan) ? { plan: account.plan } : {},
				...account.stale === true ? { stale: true } : {},
				...REASONS.has(account.reason) ? { reason: account.reason } : {},
				...time(account.retryAt) ? { retryAt: account.retryAt } : {},
				windows: account.windows.map((window) => {
					if (!window || !idOf(window.id) || windows.has(window.id) || typeof window.usedPercent !== "number" || !Number.isFinite(window.usedPercent) || window.usedPercent < 0 || window.usedPercent > 100) throw new Error("invalid quota window");
					windows.add(window.id);
					if (window.resetsAt !== void 0 && !time(window.resetsAt)) throw new Error("invalid quota reset");
					if (window.windowSeconds !== void 0 && (!Number.isSafeInteger(window.windowSeconds) || window.windowSeconds <= 0)) throw new Error("invalid quota duration");
					return {
						id: window.id,
						usedPercent: window.usedPercent,
						...text(window.label) ? { label: window.label } : {},
						...window.resetsAt === void 0 ? {} : { resetsAt: window.resetsAt },
						...window.windowSeconds === void 0 ? {} : { windowSeconds: window.windowSeconds }
					};
				})
			};
		})
	};
}
/** One registry per Host composition. Unload aborts work and invalidates every binding. */
function createQuotaRegistry() {
	const sources = /* @__PURE__ */ new Map();
	let generation = 0;
	let disposed = false;
	const listeners = /* @__PURE__ */ new Set();
	const notify = () => {
		for (const listener of listeners) try {
			listener();
		} catch {}
	};
	const revisionOf = (entry) => {
		const revision = entry.source.revision();
		if (typeof revision !== "string" || revision.length > 256) throw new Error("invalid quota revision");
		return `${entry.generation}:${revision}`;
	};
	return {
		protocolVersion: 1,
		register(source) {
			if (disposed) throw new Error("quota registry disposed");
			if (!source || source.protocolVersion !== 1 || !idOf(source.id) || !text(source.displayName) || typeof source.read !== "function" || typeof source.revision !== "function" || !Array.isArray(source.providerRoutes) || !source.providerRoutes.every(idOf)) throw new Error("invalid quota source");
			if (sources.has(source.id)) throw new Error("duplicate quota source");
			const sourceId = source.id;
			const routes = [...source.providerRoutes];
			for (const other of sources.values()) if (routes.some((route) => other.routes.includes(route))) throw new Error("duplicate quota route");
			const entry = {
				source,
				displayName: source.displayName,
				routes,
				generation: ++generation,
				controller: new AbortController()
			};
			revisionOf(entry);
			sources.set(sourceId, entry);
			notify();
			return () => {
				if (sources.get(sourceId) !== entry) return;
				sources.delete(sourceId);
				entry.controller.abort();
				notify();
			};
		},
		list() {
			const entries = [];
			for (const [id, entry] of sources) try {
				entries.push({
					id,
					displayName: entry.displayName,
					providerRoutes: [...entry.routes],
					revision: revisionOf(entry)
				});
			} catch {}
			return entries;
		},
		async read(id, revision, options = {}) {
			const entry = sources.get(id);
			if (!entry || revisionOf(entry) !== revision) throw bindingChanged();
			const signal = options.signal ? AbortSignal.any([options.signal, entry.controller.signal]) : entry.controller.signal;
			signal.throwIfAborted();
			let raw;
			try {
				raw = await abortable(Promise.resolve().then(() => {
					signal.throwIfAborted();
					return entry.source.read({ signal });
				}), signal);
			} catch (error) {
				if (sources.get(id) !== entry || revisionOf(entry) !== revision) throw bindingChanged();
				throw error;
			}
			if (sources.get(id) !== entry || revisionOf(entry) !== revision) throw bindingChanged();
			signal.throwIfAborted();
			return projectQuotaSnapshot(raw);
		},
		subscribe(listener) {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		dispose() {
			disposed = true;
			for (const entry of sources.values()) entry.controller.abort();
			sources.clear();
			notify();
			listeners.clear();
		}
	};
}
/** Adapt multiple accounts to Usage Stats' existing subscription-window view. */
function quotaAccountSnapshot(base, snapshot) {
	const accounts = snapshot.accounts;
	const healthy = accounts.filter((account) => account.status === "ok" && !account.stale);
	const windows = accounts.flatMap((account) => account.windows.map((window) => ({
		kind: window.windowSeconds === 604800 ? "weekly" : window.id === "primary" ? "session" : "quota",
		label: [account.label, window.label ?? window.id].filter(Boolean).join(" / "),
		account: account.id,
		usedPercent: window.usedPercent,
		remainingPercent: 100 - window.usedPercent,
		...window.resetsAt === void 0 ? {} : { resetsAt: new Date(window.resetsAt).toISOString() },
		...window.windowSeconds === void 0 ? {} : { windowSeconds: window.windowSeconds }
	})));
	const status = accounts.length === 0 ? "not-configured" : healthy.length === accounts.length && windows.length > 0 ? "ok" : accounts.find((account) => account.status !== "ok")?.status ?? "unavailable";
	return {
		...base,
		status,
		windows,
		source: "quota-plugin",
		plan: healthy.find((account) => account.plan)?.plan,
		observedAt: snapshot.observedAt,
		stale: accounts.some((account) => account.stale === true),
		...accounts.find((account) => account.reason)?.reason ? { reason: accounts.find((account) => account.reason).reason } : {},
		...accounts.length > 1 && healthy.length !== accounts.length ? { partial: ["quota-account-failed"] } : {}
	};
}
export { createQuotaRegistry, projectQuotaSnapshot, quotaAccountSnapshot };

//# sourceMappingURL=quota.js.map