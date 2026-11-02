import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveAccountSpec } from "../lib/accounts.js";
import {
	validateProviderOption, validateProviderOptionId, validateProviderOptions,
	combineMonitorConfig, loadProviderOptions, saveProviderOptions
} from "../lib/provider-options.js";

const defaults = validateProviderOption({});
assert.deepEqual(defaults, { adapter: null, displayMetric: "auto", usageBaseURL: null, credentialRef: null });
for (const id of ["__proto__", "constructor", "bad/provider", "../escape", ""]) {
	assert.throws(() => validateProviderOptionId(id), /invalid provider/);
}
assert.throws(() => validateProviderOption({ adapter: "orcarouter-balance" }), /unsupported/);
assert.throws(() => validateProviderOption({ adapter: "new-api", usageBaseURL: "http://localhost:1234" }), /HTTPS/);
assert.throws(() => validateProviderOption({ adapter: "new-api", usageBaseURL: "https://user:pass@relay.example/v1" }), /HTTPS/);
assert.throws(() => validateProviderOption({ adapter: "new-api", credentialRef: "sk-actual-secret" }), /credential reference/);
assert.throws(() => validateProviderOption({ credentialRef: "ZAI_KEY" }), /select a monitor adapter/);
assert.throws(() => validateProviderOption({ displayMetric: "window:unsupported" }), /display metric/);
assert.equal(validateProviderOption({ adapter: "new-api", displayMetric: "window:monthly" }).displayMetric, "window:monthly");

const options = validateProviderOptions({
	zai: { adapter: "new-api", displayMetric: "window:quota", credentialRef: "NEWAPI_TOKEN", usageBaseURL: "https://relay.example" },
	"opencode-go": { displayMetric: "window:monthly" },
	"deepseek-official": { displayMetric: "balance" }
});
const base = { "zai": { adapter: "zai-token-plan", warning: { warnBelow: 25 } } };
const monitors = combineMonitorConfig(base, options);
assert.equal(monitors.zai.adapter, "new-api");
assert.equal(monitors.zai.usageBaseURL, "https://relay.example");
assert.equal(monitors.zai.credentialRef, "NEWAPI_TOKEN");
assert.deepEqual(monitors.zai.warning, { warnBelow: 25 });
assert.equal(monitors["opencode-go"], undefined, "display-only selection must not rewrite an adapter");
const zai = resolveAccountSpec({ id: "zai", apiKeyEnv: "ZAI_API_KEY", baseURL: "https://relay.example/v1" }, { monitors });
assert.equal(zai.adapter, "new-api", "explicit backend wins over canonical route id");
assert.equal(zai.apiKeyRef, "NEWAPI_TOKEN");
assert.equal(zai.baseURL, "https://relay.example");
assert.equal(resolveAccountSpec({ id: "opencode-go" }, { monitors }).adapter, "opencode-go");

const temp = await mkdtemp(join(tmpdir(), "dsh-quota-options-"));
try {
	const location = join(temp, "config", "usage-stats-provider-options.json");
	assert.equal(Object.keys(await loadProviderOptions(location)).length, 0);
	await saveProviderOptions(options, location);
	assert.deepEqual({ ...(await loadProviderOptions(location)) }, { ...options });
	const raw = await readFile(location, "utf8");
	assert.equal(raw.includes("sk-actual-secret"), false);
	assert.deepEqual(Object.keys(JSON.parse(raw)).sort(), ["deepseek-official", "opencode-go", "zai"]);
} finally {
	await rm(temp, { recursive: true, force: true });
}
console.log("PROVIDER OPTIONS TESTS PASSED");
