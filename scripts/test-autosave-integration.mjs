// Real React Codex-card acceptance, reusing the two repos' declared test/build deps.
// node scripts/test-autosave-integration.mjs ../dsh-plugin-chatgpt
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { resolve, join } from 'node:path'
const require = createRequire(import.meta.url)
const React = require('react')
const { create, act } = require('react-test-renderer')
const target = resolve(process.argv[2] ?? '../dsh-plugin-chatgpt')
const { build } = createRequire(join(target, 'package.json'))('esbuild')
const result = await build({ entryPoints: [join(target, 'src/client/codex-quota.tsx')], bundle: true,
  format: 'cjs', platform: 'browser', jsx: 'automatic', external: ['react', 'react/jsx-runtime'], write: false })
const module = { exports: {} }
new Function('require', 'module', 'exports', result.outputFiles[0].text)(require, module, module.exports)
const { CodexQuotaCard } = module.exports
let value = { defaultPath: '/synthetic/.codex/auth.json', allowRefresh: false, label: '' }
let gate, fail = false, clearCount = 0, queries = 0
const writes = []
const api = {
  codexQuotaStatus: async () => ({ ok: true, value }),
  selectCodexQuota: async (path, allowRefresh, label) => {
    writes.push({ path, allowRefresh, label })
    if (gate) { const wait = gate; gate = undefined; await wait }
    if (fail) { fail = false; return { ok: false, error: { message: 'file-unavailable' } } }
    value = { ...value, path, allowRefresh, label }
    return { ok: true, value }
  },
  clearCodexQuota: async () => {
    clearCount++; value = { defaultPath: value.defaultPath, allowRefresh: false, label: '' }
    return { ok: true, value }
  },
  refreshCodexQuota: async () => { queries++; return { ok: true, value } },
}
const remote = async () => api
let renderer
const input = index => renderer.root.findAllByType('input')[index]
const button = text => renderer.root.findAllByType('button').find(node => node.props.children === text)
const settle = async () => { for (let i = 0; i < 30; i++) await Promise.resolve() }
try {
  await act(async () => { renderer = create(React.createElement(CodexQuotaCard, { remote })) })
  assert.equal(writes.length, 0, 'initial load must not grant authority or choose a default file')
  assert.ok(renderer.root.findAllByType('button').every(node => !String(node.props.children).includes('保存')))
  await act(async () => { button('填入默认路径').props.onClick() })
  assert.deepEqual(writes.at(-1), { path: value.defaultPath, allowRefresh: false, label: '' })
  await act(async () => { input(2).props.onChange({ target: { checked: true } }) })
  assert.equal(value.allowRefresh, true, 'only explicit checkbox action grants writeback')
  await act(async () => { input(2).props.onChange({ target: { checked: false } }) })
  assert.equal(value.allowRefresh, false)
  const count = writes.length
  await act(async () => {
    input(1).props.onChange({ target: { value: 'a' } })
    input(1).props.onChange({ target: { value: '自动保存' } })
  })
  assert.equal(writes.length, count)
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 650)) })
  assert.equal(value.label, '自动保存', 'text saves after inactivity without blur')
  let release
  gate = new Promise(resolve => { release = resolve })
  await act(async () => { input(2).props.onChange({ target: { checked: true } }) })
  await act(async () => { input(1).props.onChange({ target: { value: 'newest' } }); input(1).props.onBlur() })
  assert.equal(input(1).props.disabled, false)
  await act(async () => { release(); await settle() })
  assert.equal(value.label, 'newest')
  assert.equal(input(1).props.value, 'newest')
  fail = true
  await act(async () => { input(1).props.onChange({ target: { value: 'retry' } }); input(1).props.onBlur() })
  assert.equal(renderer.root.findAllByProps({ role: 'alert' }).length, 1)
  assert.equal(input(1).props.value, 'retry')
  await act(async () => { input(1).props.onBlur() })
  assert.equal(renderer.root.findAllByProps({ role: 'alert' }).length, 0)
  assert.equal(value.label, 'retry')
  await act(async () => { input(1).props.onChange({ target: { value: 'before-query' } }) })
  await act(async () => { await button('查询额度').props.onClick(); await settle() })
  assert.equal(value.label, 'before-query')
  assert.equal(queries, 1)
  await act(async () => { input(1).props.onChange({ target: { value: 'discard-on-stop' } }) })
  await act(async () => { button('停止监控').props.onClick(); await settle() })
  assert.equal(clearCount, 1)
  assert.equal(value.path, undefined)
  assert.equal(input(0).props.value, '')
  assert.ok(!writes.some(write => write.label === 'discard-on-stop'))
  await act(async () => { button('填入默认路径').props.onClick() })
  await act(async () => { input(1).props.onChange({ target: { value: 'on-unmount' } }) })
  await act(async () => { renderer.unmount(); await settle() })
  assert.equal(value.label, 'on-unmount')
  console.log('Codex real React autosave: no implicit consent, debounce, serialization, failure/retry, query flush, stop cancellation and unmount flush passed')
} finally { if (renderer) await act(async () => { renderer.unmount() }) }
