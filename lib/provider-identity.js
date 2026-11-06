import { isPrivateHostname } from "./network.js";
// src/provider-identity.ts
/**
* Provider identity policy shared by account monitoring and session context.
*
* Identity is route-aware: a configured route id remains the account boundary,
* even when two routes use the same upstream model. Classification follows one
* strict precedence order: explicit monitor adapter, canonical route id,
* canonical base-URL hostname, then unknown. Display labels are presentation
* only and never participate in inference.
*
* @module dsh-usage-stats/provider-identity
*/
/** Bump whenever route classification can change pricing eligibility. */
const PROVIDER_IDENTITY_POLICY_VERSION = 2;
const ADAPTER_IDENTITIES = Object.freeze({
	"deepseek-balance": {
		providerFamily: "deepseek",
		pricingFamily: "deepseek"
	},
	"deepseek-account": {
		providerFamily: "deepseek",
		pricingFamily: "unknown"
	},
	"openrouter-balance": {
		providerFamily: "openrouter",
		pricingFamily: "openrouter"
	},
	"moonshot-balance": {
		providerFamily: "moonshot",
		pricingFamily: "moonshot"
	},
	"zai-balance": {
		providerFamily: "zai",
		pricingFamily: "zai"
	},
	"commandcode-goat": {
		providerFamily: "commandcode",
		pricingFamily: "unknown"
	},
	general: {
		providerFamily: "unknown",
		pricingFamily: "unknown"
	},
	"new-api": {
		providerFamily: "new-api",
		pricingFamily: "unknown"
	},
	sub2api: {
		providerFamily: "sub2api",
		pricingFamily: "unknown"
	},
	"sub2api-auth": {
		providerFamily: "sub2api",
		pricingFamily: "unknown"
	},
	"opencode-go": {
		providerFamily: "opencode-go",
		pricingFamily: "opencode-go"
	},
	"zai-token-plan": {
		providerFamily: "zai",
		pricingFamily: "zai"
	},
	"kimi-token-plan": {
		providerFamily: "kimi",
		pricingFamily: "kimi"
	},
	"minimax-token-plan": {
		providerFamily: "minimax",
		pricingFamily: "minimax"
	},
	ollama: {
		providerFamily: "ollama",
		pricingFamily: "ollama"
	},
	"codearts-credits": {
		providerFamily: "codearts",
		pricingFamily: "unknown"
	},
	declarative: {
		providerFamily: "unknown",
		pricingFamily: "unknown"
	}
});
const CANONICAL_ROUTES = Object.freeze({
	"deepseek-official": {
		providerFamily: "deepseek",
		accountAdapter: "deepseek-balance",
		balanceScheme: "deepseek"
	},
	"deepseek-account": {
		providerFamily: "deepseek",
		accountAdapter: "deepseek-account",
		pricingFamily: "unknown",
		balanceScheme: null
	},
	deepseek: {
		providerFamily: "deepseek",
		accountAdapter: "deepseek-balance",
		balanceScheme: "deepseek"
	},
	openrouter: {
		providerFamily: "openrouter",
		accountAdapter: "openrouter-balance",
		balanceScheme: "openrouter"
	},
	moonshotai: {
		providerFamily: "moonshot",
		accountAdapter: "moonshot-balance",
		balanceScheme: "moonshot"
	},
	"moonshotai-cn": {
		providerFamily: "moonshot",
		accountAdapter: "moonshot-balance",
		balanceScheme: "moonshot"
	},
	kimi: {
		providerFamily: "moonshot",
		accountAdapter: "moonshot-balance",
		balanceScheme: "moonshot"
	},
	"kimi-coding": {
		providerFamily: "kimi",
		accountAdapter: "kimi-token-plan",
		balanceScheme: "moonshot"
	},
	"kimi-for-coding": {
		providerFamily: "kimi",
		accountAdapter: "kimi-token-plan",
		balanceScheme: null
	},
	zai: {
		providerFamily: "zai",
		accountAdapter: "zai-token-plan",
		balanceScheme: "zai"
	},
	"zai-coding-cn": {
		providerFamily: "zai",
		accountAdapter: "zai-token-plan",
		balanceScheme: "zai"
	},
	"opencode-go": {
		providerFamily: "opencode-go",
		accountAdapter: "opencode-go",
		balanceScheme: null
	},
	minimax: {
		providerFamily: "minimax",
		accountAdapter: "minimax-token-plan",
		balanceScheme: null
	},
	minimaxi: {
		providerFamily: "minimax",
		accountAdapter: "minimax-token-plan",
		balanceScheme: null
	},
	"minimax-cn": {
		providerFamily: "minimax",
		accountAdapter: "minimax-token-plan",
		balanceScheme: null
	},
	"minimax-coding": {
		providerFamily: "minimax",
		accountAdapter: "minimax-token-plan",
		balanceScheme: null
	},
	commandcode: {
		providerFamily: "commandcode",
		accountAdapter: "commandcode-goat",
		pricingFamily: "unknown"
	},
	passion: {
		providerFamily: "sub2api",
		accountAdapter: "sub2api",
		pricingFamily: "unknown",
		balanceScheme: null
	},
	codearts: {
		providerFamily: "codearts",
		accountAdapter: "codearts-credits",
		balanceScheme: null
	},
	buddy: {
		providerFamily: "codearts",
		accountAdapter: "codearts-credits",
		balanceScheme: null
	},
	workbuddy: {
		providerFamily: "codearts",
		accountAdapter: "codearts-credits",
		balanceScheme: null
	},
	lobsterai: {
		providerFamily: "codearts",
		accountAdapter: "codearts-credits",
		balanceScheme: null
	},
	qoder: {
		providerFamily: "codearts",
		accountAdapter: "codearts-credits",
		balanceScheme: null
	},
	qodercn: {
		providerFamily: "codearts",
		accountAdapter: "codearts-credits",
		balanceScheme: null
	},
	trae: {
		providerFamily: "codearts",
		accountAdapter: "codearts-credits",
		balanceScheme: null
	},
	cline: {
		providerFamily: "codearts",
		accountAdapter: "codearts-credits",
		balanceScheme: null
	},
	loomy: {
		providerFamily: "codearts",
		accountAdapter: "codearts-credits",
		balanceScheme: null
	},
	raccoon: {
		providerFamily: "codearts",
		accountAdapter: "codearts-credits",
		balanceScheme: null
	},
	zcode: {
		providerFamily: "codearts",
		accountAdapter: "codearts-credits",
		balanceScheme: null
	}
});
/**
* Route ids that name a family rather than one exact profile. The Command Code
* provider plugins publish one route per subscription tier and wire protocol
* (`commandcode-goat-autosync`, `commandcode-pro-anthropic`, …), so the
* prefix is the stable fact and the suffix belongs to the deployment. A route
* that is not recognized stays unknown; the prefix never widens into a
* different vendor.
*/
const CANONICAL_ROUTE_PREFIXES = Object.freeze([Object.freeze(["commandcode-", Object.freeze({
	providerFamily: "commandcode",
	accountAdapter: "commandcode-goat",
	pricingFamily: "unknown"
})])]);
function routeRuleOf(routeId) {
	const exact = CANONICAL_ROUTES[routeId];
	if (exact !== void 0) return exact;
	return CANONICAL_ROUTE_PREFIXES.find(([prefix]) => routeId.startsWith(prefix))?.[1];
}
function nonEmptyString(value) {
	return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}
function hostnameOf(baseURL) {
	if (nonEmptyString(baseURL) === null) return null;
	try {
		return new URL(baseURL).hostname.toLowerCase().replace(/\.$/, "");
	} catch {
		return null;
	}
}
function hostRule(hostname) {
	if (hostname === "api.deepseek.com") return {
		providerFamily: "deepseek",
		accountAdapter: "deepseek-balance"
	};
	if (hostname === "commandcode.ai" || hostname.endsWith(".commandcode.ai")) return {
		providerFamily: "commandcode",
		accountAdapter: "commandcode-goat",
		pricingFamily: "unknown"
	};
	if (hostname === "passionapi.com" || hostname.endsWith(".passionapi.com")) return {
		providerFamily: "sub2api",
		accountAdapter: "sub2api",
		pricingFamily: "unknown"
	};
	if (hostname === "ollama.com" || hostname.endsWith(".ollama.com")) return {
		providerFamily: "ollama",
		accountAdapter: "ollama"
	};
	return null;
}
function buildProviderIdentity(provider, rule, confidence) {
	const routeId = nonEmptyString(provider?.id) ?? "unknown";
	const displayName = nonEmptyString(provider?.displayName) ?? routeId;
	const baseURL = nonEmptyString(provider?.baseURL);
	const providerFamily = rule?.providerFamily ?? "unknown";
	return {
		routeId,
		displayName,
		providerFamily,
		accountAdapter: rule?.accountAdapter ?? null,
		pricingFamily: rule?.pricingFamily ?? providerFamily,
		baseURL,
		confidence
	};
}
/** Return the legacy built-in balance scheme without duplicating route policy. */
function balanceSchemeForProviderId(providerId) {
	return CANONICAL_ROUTES[providerId]?.balanceScheme ?? null;
}
/**
* Resolve one configured provider route to stable semantic boundaries.
* Explicit monitor configuration always wins. Unknown or malformed inputs
* remain unknown instead of falling back to the human-readable display name.
*/
function resolveProviderIdentity(provider, config = { monitors: {} }) {
	const routeId = nonEmptyString(provider?.id) ?? "unknown";
	const monitor = config?.monitors?.[routeId];
	const explicitAdapter = nonEmptyString(monitor?.adapter);
	if (explicitAdapter !== null) return buildProviderIdentity(provider, {
		...ADAPTER_IDENTITIES[explicitAdapter] ?? {
			providerFamily: "unknown",
			pricingFamily: "unknown"
		},
		accountAdapter: explicitAdapter
	}, "explicit");
	if (provider?.accountService === "creditBalance" && nonEmptyString(provider?.apiKeyEnv) === null && nonEmptyString(provider?.baseURL) === null) return buildProviderIdentity(provider, {
		...ADAPTER_IDENTITIES["codearts-credits"],
		accountAdapter: "codearts-credits"
	}, "host-service");
	const canonical = routeRuleOf(routeId);
	if (canonical !== void 0) return buildProviderIdentity(provider, canonical, "canonical-id");
	const hostname = hostnameOf(provider?.baseURL);
	if (hostname !== null) {
		if (routeId === "ollama" && !isPrivateHostname(hostname)) return buildProviderIdentity(provider, {
			providerFamily: "ollama",
			accountAdapter: "ollama"
		}, "canonical-id");
		const canonicalHost = hostRule(hostname);
		if (canonicalHost !== null) return buildProviderIdentity(provider, canonicalHost, "canonical-host");
	}
	return buildProviderIdentity(provider, null, "unknown");
}
export { PROVIDER_IDENTITY_POLICY_VERSION, balanceSchemeForProviderId, resolveProviderIdentity };

//# sourceMappingURL=provider-identity.js.map