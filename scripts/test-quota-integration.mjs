/** Real Cordis + built ChatGPT quota owner + Usage Stats, with synthetic upstream only. */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { resolve, join } from 'node:path';
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { createQuotaRegistry } from '../lib/quota.js';
import { createAccountService } from '../lib/accounts.js';
const plugin = resolve(process.argv[2] ?? '../dsh-plugin-chatgpt');
const peer = createRequire(join(plugin, 'package.json'));
const { Context } = await import(pathToFileURL(peer.resolve('@deepseek-ai/cordis')).href);
const { CodexQuota, registerCodexQuota } = await import(pathToFileURL(join(plugin, 'lib/codex-quota.js')).href);
const base = resolve('.agent-work/tmp/quota-integration'); mkdirSync(base, { recursive: true });
const dir = mkdtempSync(join(base, 'case-'));
const ctx = new Context();
const forks = [];
const settle = async () => { for (let i = 0; i < 8; i++) await new Promise(resolve => setTimeout(resolve, 0)); };
let refreshes = 0;
const auth = join(dir, 'auth.json');
writeFileSync(auth, JSON.stringify({ auth_mode: 'chatgpt', tokens: { access_token: 'SYNTHETIC_ACCESS_OLD', refresh_token: 'SYNTHETIC_REFRESH_OLD', account_id: 'SYNTHETIC_ACCOUNT' } }), { mode: 0o600 });
const quotaOwner = new CodexQuota(join(dir, 'state'), async (url, init) => {
  if (String(url).includes('/oauth/token')) { refreshes++; return Response.json({ access_token: 'SYNTHETIC_ACCESS_NEW', refresh_token: 'SYNTHETIC_REFRESH_NEW' }); }
  if (init.headers.authorization !== 'Bearer SYNTHETIC_ACCESS_NEW') return Response.json({}, { status: 401 });
  return Response.json({ plan_type: 'plus', rate_limit: { primary_window: { used_percent: 15, limit_window_seconds: 18000 }, secondary_window: { used_percent: 60, limit_window_seconds: 604800 } } });
});
quotaOwner.select(auth, true, '独立监控账号');
try {
  const producer = ctx.plugin(inner => registerCodexQuota(inner, quotaOwner, 'custom-chatgpt'));
  forks.push(producer); await settle();
  assert.equal(ctx.get('usageQuota'), undefined, 'producer remains active without stats');
  const registry = createQuotaRegistry();
  const host = ctx.plugin(inner => { inner.provide('usageQuota', registry); inner.effect(() => () => registry.dispose()); });
  forks.push(host); await settle();
  assert.equal(registry.list().length, 1, 'late sibling Host service activates the production injection');
  const stats = createAccountService({ credentials: { resolve() { throw Error('consumer must not access credentials'); } },
    getProviders: async () => [{ id: 'custom-chatgpt', displayName: 'Custom ChatGPT' }], deps: { includeLegacyProviders: false, usageQuota: () => ctx.get('usageQuota') } });
  const result = await stats.get('custom-chatgpt');
  assert.equal(result.status, 'ok'); assert.deepEqual(result.windows.map(w => w.remainingPercent), [85, 40]); assert.equal(refreshes, 1);
  assert.equal(JSON.parse(readFileSync(auth, 'utf8')).tokens.refresh_token, 'SYNTHETIC_REFRESH_NEW');
  for (const secret of ['SYNTHETIC_ACCESS', 'SYNTHETIC_REFRESH', 'SYNTHETIC_ACCOUNT']) assert.ok(!JSON.stringify(result).includes(secret));
  await host.dispose(); await settle();
  assert.equal((await stats.get('custom-chatgpt')).status, 'unsupported');
  const next = createQuotaRegistry();
  const replacement = ctx.plugin(inner => { inner.provide('usageQuota', next); inner.effect(() => () => next.dispose()); });
  forks.push(replacement); await settle();
  assert.equal(next.list().length, 1, 'replacement service re-registers the same source');
  assert.equal((await stats.get('custom-chatgpt')).status, 'ok');
  await producer.dispose(); await settle();
  assert.equal(next.list().length, 0, 'producer unload disposes its registration');
  assert.equal((await stats.get('custom-chatgpt')).status, 'unsupported');
  console.log('PASS real Cordis quota integration: late activation, refresh/writeback, custom route, redaction, Host replacement, producer unload');
} finally {
  for (const fork of forks.reverse()) await fork.dispose();
  if (!dir.startsWith(`${base}/`)) throw new Error('unexpected fixture path');
  rmSync(dir, { recursive: true, force: true });
}
