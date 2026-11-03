import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createQuotaRegistry, projectQuotaSnapshot } from '../lib/quota.js';
import { createAccountService } from '../lib/accounts.js';
const at = 1_800_000_000_000;
const snapshot = (used = 25) => ({ observedAt: at, accounts: [{ id: 'opaque-1', label: 'Codex（独立监控账号）', status: 'ok', windows: [
  { id: 'primary', usedPercent: used, windowSeconds: 18000, resetsAt: at + 3600000 },
  { id: 'secondary', usedPercent: 50, windowSeconds: 604800 }
] }] });
function source(overrides = {}) { return { protocolVersion: 1, id: 'chatgpt.codex', displayName: 'Codex quota', providerRoutes: ['chatgpt'], revision: () => 'binding-a', read: async () => snapshot(), ...overrides }; }
function service(registry, options = {}) { return createAccountService({ credentials: { resolve: async () => { throw new Error('must not read credentials'); } },
  getProviders: async () => [{ id: 'chatgpt', displayName: 'ChatGPT' }], config: { monitors: {} },
  deps: { includeLegacyProviders: false, now: () => at, usageQuota: () => registry, ...options } }); }

test('v1 registration, projection, multiple windows and exact remaining percentage', async () => {
  const registry = createQuotaRegistry(); registry.register(source());
  const accounts = service(registry);
  const result = await accounts.get('chatgpt');
  assert.equal(result.adapter, 'quota-source'); assert.equal(result.mode, 'subscription'); assert.equal(result.status, 'ok');
  assert.deepEqual(result.windows.map(w => w.remainingPercent), [75, 50]);
  assert.deepEqual(result.windows.map(w => w.kind), ['session', 'weekly']);
  assert.equal(result.lastSuccessAt, at); assert.equal(result.observedAt, at);
});
test('absent/late source and removal do not hide native routes', async () => {
  const registry = createQuotaRegistry(); const accounts = service(registry);
  assert.equal((await accounts.get('chatgpt')).status, 'unsupported');
  const remove = registry.register(source());
  assert.equal((await accounts.get('chatgpt')).status, 'ok');
  remove(); assert.equal((await accounts.get('chatgpt')).status, 'unsupported');
});
test('replacement and identity revision cannot reuse previous account cache', async () => {
  const registry = createQuotaRegistry(); let revision = 'a'; let used = 10;
  const remove = registry.register(source({ revision: () => revision, read: async () => snapshot(used) }));
  const accounts = service(registry);
  assert.equal((await accounts.get('chatgpt')).windows[0].remainingPercent, 90);
  revision = 'b'; used = 80;
  assert.equal((await accounts.get('chatgpt')).windows[0].remainingPercent, 20);
  remove(); registry.register(source({ read: async () => snapshot(50) }));
  assert.equal((await accounts.get('chatgpt')).windows[0].remainingPercent, 50);
});
test('explicit/native adapter ownership is not overridden; source gets its own monitor', async () => {
  const registry = createQuotaRegistry(); registry.register(source({ providerRoutes: ['deepseek-official'] }));
  const accounts = createAccountService({ credentials: {}, getProviders: async () => [{ id: 'deepseek-official' }], deps: { usageQuota: registry, includeLegacyProviders: false } });
  const views = await accounts.providerViews();
  assert.equal(views.find(v => v.id === 'deepseek-official').adapter, 'deepseek-balance');
  assert.equal(views.find(v => v.id === 'chatgpt.codex').adapter, 'quota-source');
});
test('duplicate ids/routes and wrong protocol versions fail closed', () => {
  const registry = createQuotaRegistry(); registry.register(source());
  assert.throws(() => registry.register(source()), /duplicate/);
  assert.throws(() => registry.register(source({ id: 'second' })), /duplicate/);
  assert.throws(() => registry.register(source({ id: 'second', providerRoutes: [], protocolVersion: 2 })), /invalid/);
});
test('unknown fields are projected away and malformed percentage/time never becomes zero', () => {
  const raw = snapshot(); raw.secret = 'never'; raw.accounts[0].accessToken = 'never'; raw.accounts[0].windows[0].raw = { secret: 'never' };
  assert.ok(!JSON.stringify(projectQuotaSnapshot(raw)).includes('never'));
  for (const value of [NaN, Infinity, -1, 101, '10', undefined]) {
    const raw = snapshot(); raw.accounts[0].windows[0].usedPercent = value; assert.throws(() => projectQuotaSnapshot(raw));
  }
  const rawTime = snapshot(); rawTime.accounts[0].windows[0].resetsAt = Number.MAX_SAFE_INTEGER; assert.throws(() => projectQuotaSnapshot(rawTime));
});
test('failed and stale account windows remain explicitly stale, never fresh zero', async () => {
  const registry = createQuotaRegistry(); registry.register(source({ read: async () => ({ observedAt: at - 1000, accounts: [
    { ...snapshot().accounts[0], stale: true, status: 'unavailable', reason: 'persistence-failed' }
  ] }) }));
  const result = await service(registry).get('chatgpt');
  assert.equal(result.status, 'unavailable'); assert.equal(result.stale, true); assert.equal(result.reason, 'persistence-failed');
  assert.equal(result.windows[0].remainingPercent, 75);
});
test('late non-cooperative source completion after unregister rejects and cannot become a new snapshot', async () => {
  const registry = createQuotaRegistry(); let finish;
  const started = new Promise(resolve => { finish = resolve; });
  const remove = registry.register(source({ read: async () => started }));
  const binding = registry.list()[0];
  const result = registry.read(binding.id, binding.revision);
  remove(); finish(snapshot());
  await assert.rejects(result);
});
test('caller cancellation is bounded even if producer ignores its signal', async () => {
  const registry = createQuotaRegistry(); registry.register(source({ read: async () => new Promise(() => {}) }));
  const controller = new AbortController(); const binding = registry.list()[0];
  const result = registry.read(binding.id, binding.revision, { signal: controller.signal });
  controller.abort(); await assert.rejects(result);
});
test('account change during query must not return stale data from previous binding', async () => {
  const registry = createQuotaRegistry(); let revision = 'a'; let change = false;
  registry.register(source({ revision: () => revision, read: async () => { if (change) revision = 'b'; return snapshot(); } }));
  const accounts = service(registry);
  assert.equal((await accounts.get('chatgpt')).status, 'ok'); change = true;
  const result = await accounts.get('chatgpt', { force: true });
  assert.equal(result.status, 'unsupported'); assert.equal(result.windows.length, 0); assert.equal(result.stale, false);
});
test('reused provider objects remain untouched across source removal', async () => {
  const registry = createQuotaRegistry(); const providers = [{ id: 'chatgpt' }];
  const accounts = createAccountService({ credentials: {}, getProviders: async () => providers, deps: { includeLegacyProviders: false, usageQuota: registry } });
  const remove = registry.register(source()); assert.equal((await accounts.get('chatgpt')).status, 'ok');
  assert.equal(providers[0].quotaBinding, undefined); remove();
  assert.equal((await accounts.get('chatgpt')).status, 'unsupported');
});
test('unregister during refresh does not retain the previous account as stale', async () => {
  const registry = createQuotaRegistry(); let hold = false; let began;
  const started = new Promise(resolve => { began = resolve; });
  const remove = registry.register(source({ read: async () => { if (hold) { began(); return await new Promise(() => {}); } return snapshot(); } }));
  const accounts = service(registry); await accounts.get('chatgpt'); hold = true;
  const pending = accounts.get('chatgpt', { force: true }); await started; remove();
  const result = await pending; assert.equal(result.status, 'unsupported'); assert.equal(result.windows.length, 0); assert.equal(result.stale, false);
});
test('metadata mutation cannot prevent disposal and disposed registry cannot reactivate', () => {
  const registry = createQuotaRegistry(); const input = source(); const remove = registry.register(input);
  input.id = 'changed'; input.displayName = 'changed'; input.providerRoutes.push('changed');
  assert.equal(registry.list()[0].id, 'chatgpt.codex'); assert.equal(registry.list()[0].displayName, 'Codex quota');
  remove(); assert.equal(registry.list().length, 0); registry.dispose(); assert.throws(() => registry.register(source()), /disposed/);
});
test('successful empty account windows are invalid rather than fresh zero', () => {
  assert.throws(() => projectQuotaSnapshot({ observedAt: at, accounts: [{ id: 'x', status: 'ok', windows: [] }] }));
});
test('independent sources coexist; partial multi-account failure stays visible', async () => {
  const registry = createQuotaRegistry(); registry.register(source({ read: async () => ({ observedAt: at, accounts: [snapshot().accounts[0], { id: 'second', status: 'unauthorized', reason: 'reauth-required', windows: [] }] }) }));
  registry.register(source({ id: 'other', providerRoutes: ['other'] }));
  assert.equal(registry.list().length, 2);
  const result = await service(registry).get('chatgpt');
  assert.equal(result.status, 'unauthorized'); assert.deepEqual(result.partial, ['quota-account-failed']); assert.equal(result.windows.length, 2);
});
