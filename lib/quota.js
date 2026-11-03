/** Host-only quota-source protocol v1. No credentials or upstream response objects cross this seam. */
const STATUSES = new Set(['ok', 'not-configured', 'unauthorized', 'rate-limited', 'unavailable', 'invalid-response']);
const REASONS = new Set(['reauth-required', 'credential-conflict', 'persistence-failed', 'invalid-auth-file', 'file-unavailable', 'refresh-busy', 'unsupported-auth-mode']);
const idOf = value => typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(value);
const text = value => typeof value === 'string' && value.length <= 160 && !/[\r\n\x00-\x1f]/.test(value);
const time = value => Number.isSafeInteger(value) && value >= 0 && value <= 8_640_000_000_000_000;
const bindingChanged = () => Object.assign(new Error('quota binding changed'), { name: 'QuotaBindingChanged' });
async function abortable(operation, signal) {
	let listener;
	try {
		return await Promise.race([operation, new Promise((_, reject) => {
			listener = () => reject(signal.reason ?? new Error('quota read aborted'));
			if (signal.aborted) listener(); else signal.addEventListener('abort', listener, { once: true });
		})]);
	} finally { if (listener) signal.removeEventListener('abort', listener); }
}

/** Validate and project only public fields; reject malformed facts instead of inventing zero. */
export function projectQuotaSnapshot(raw) {
	if (!raw || !time(raw.observedAt) || !Array.isArray(raw.accounts) || raw.accounts.length > 50) throw new Error('invalid quota snapshot');
	const seen = new Set();
	return {
		observedAt: raw.observedAt,
		accounts: raw.accounts.map(account => {
			if (!account || !idOf(account.id) || seen.has(account.id) || !STATUSES.has(account.status) || !Array.isArray(account.windows) || account.windows.length > 20 || (account.status === 'ok' && account.windows.length === 0)) throw new Error('invalid quota account');
			seen.add(account.id);
			const windows = new Set();
			return {
				id: account.id,
				status: account.status,
				...(text(account.label) ? { label: account.label } : {}),
				...(text(account.plan) ? { plan: account.plan } : {}),
				...(account.stale === true ? { stale: true } : {}),
				...(REASONS.has(account.reason) ? { reason: account.reason } : {}),
				...(time(account.retryAt) ? { retryAt: account.retryAt } : {}),
				windows: account.windows.map(window => {
					if (!window || !idOf(window.id) || windows.has(window.id) || typeof window.usedPercent !== 'number' || !Number.isFinite(window.usedPercent) || window.usedPercent < 0 || window.usedPercent > 100) throw new Error('invalid quota window');
					windows.add(window.id);
					if (window.resetsAt !== undefined && !time(window.resetsAt)) throw new Error('invalid quota reset');
					if (window.windowSeconds !== undefined && (!Number.isSafeInteger(window.windowSeconds) || window.windowSeconds <= 0)) throw new Error('invalid quota duration');
					return {
						id: window.id, usedPercent: window.usedPercent,
						...(text(window.label) ? { label: window.label } : {}),
						...(window.resetsAt === undefined ? {} : { resetsAt: window.resetsAt }),
						...(window.windowSeconds === undefined ? {} : { windowSeconds: window.windowSeconds })
					};
				})
			};
		})
	};
}

/** One registry per Host composition. Unload aborts work and invalidates every binding. */
export function createQuotaRegistry() {
	const sources = new Map();
	let generation = 0;
	let disposed = false;
	const listeners = new Set();
	const notify = () => { for (const listener of listeners) { try { listener(); } catch { /* observers do not own registration */ } } };
	const revisionOf = entry => {
		const revision = entry.source.revision();
		if (typeof revision !== 'string' || revision.length > 256) throw new Error('invalid quota revision');
		return `${entry.generation}:${revision}`;
	};
	return {
		protocolVersion: 1,
		register(source) {
			if (disposed) throw new Error('quota registry disposed');
			if (!source || source.protocolVersion !== 1 || !idOf(source.id) || !text(source.displayName) || typeof source.read !== 'function' || typeof source.revision !== 'function'
				|| !Array.isArray(source.providerRoutes) || !source.providerRoutes.every(idOf)) throw new Error('invalid quota source');
			if (sources.has(source.id)) throw new Error('duplicate quota source');
			const sourceId = source.id;
			const routes = [...source.providerRoutes];
			for (const other of sources.values()) if (routes.some(route => other.routes.includes(route))) throw new Error('duplicate quota route');
			const entry = { source, displayName: source.displayName, routes, generation: ++generation, controller: new AbortController() };
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
			for (const [id, entry] of sources) {
				try { entries.push({ id, displayName: entry.displayName, providerRoutes: [...entry.routes], revision: revisionOf(entry) }); } catch { /* one broken source cannot hide others */ }
			}
			return entries;
		},
		async read(id, revision, options = {}) {
			const entry = sources.get(id);
			if (!entry || revisionOf(entry) !== revision) throw bindingChanged();
			const signal = options.signal ? AbortSignal.any([options.signal, entry.controller.signal]) : entry.controller.signal;
			signal.throwIfAborted();
			let raw;
			try { raw = await abortable(Promise.resolve().then(() => { signal.throwIfAborted(); return entry.source.read({ signal }); }), signal); }
			catch (error) {
				if (sources.get(id) !== entry || revisionOf(entry) !== revision) throw bindingChanged();
				throw error;
			}
			if (sources.get(id) !== entry || revisionOf(entry) !== revision) throw bindingChanged();
			signal.throwIfAborted();
			return projectQuotaSnapshot(raw);
		},
		subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
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
export function quotaAccountSnapshot(base, snapshot) {
	const accounts = snapshot.accounts;
	const healthy = accounts.filter(account => account.status === 'ok' && !account.stale);
	const windows = accounts.flatMap(account => account.windows.map(window => ({
		kind: window.windowSeconds === 604800 ? 'weekly' : window.id === 'primary' ? 'session' : 'quota',
		label: [account.label, window.label ?? window.id].filter(Boolean).join(' / '),
		account: account.id,
		usedPercent: window.usedPercent,
		remainingPercent: 100 - window.usedPercent,
		...(window.resetsAt === undefined ? {} : { resetsAt: new Date(window.resetsAt).toISOString() }),
		...(window.windowSeconds === undefined ? {} : { windowSeconds: window.windowSeconds })
	})));
	const status = accounts.length === 0 ? 'not-configured' : healthy.length === accounts.length && windows.length > 0 ? 'ok'
		: accounts.find(account => account.status !== 'ok')?.status ?? 'unavailable';
	return {
		...base, status, windows, source: 'quota-plugin',
		plan: healthy.find(account => account.plan)?.plan,
		observedAt: snapshot.observedAt,
		stale: accounts.some(account => account.stale === true),
		...(accounts.find(account => account.reason)?.reason ? { reason: accounts.find(account => account.reason).reason } : {}),
		...(accounts.length > 1 && healthy.length !== accounts.length ? { partial: ['quota-account-failed'] } : {})
	};
}
