# Host 额度来源协议（v1）

Usage Stats 在其 Host composition 中通过 `ctx.provide('usageQuota', registry)` 提供进程内注册表。供应商插件负责授权、凭据、刷新与上游协议；Usage Stats 仅获取脱敏后的额度窗口。它不是 HTTP/RPC 查询凭据的旁路，也不是 DSH 内置 LLM provider 接口。

公开类型与实现通过 `@ychris12138/dsh-usage-stats/quota` 导出。生产方可以只使用结构化类型，不依赖 Usage Stats 的运行时代码；因此缺少 Usage Stats 不应影响模型调用。

## 注册

```ts
ctx.inject(['usageQuota'], child => {
  const registry = child.get('usageQuota')
  if (registry?.protocolVersion !== 1) return
  child.effect(() => registry.register({
    protocolVersion: 1,
    id: 'example.quota',
    displayName: 'Example quota',
    providerRoutes: ['example'],
    revision: () => opaqueAccountRevision,
    read: ({ signal }) => queryAndProjectQuota(signal),
  }))
})
```

- 注册返回注销函数，必须归属注入子上下文。卸载生产方、移除或替换消费方均不得残留注册。
- `id` 与单个 `providerRoutes` 路由不可被多个来源重复声明。拒绝冲突，不按加载顺序覆盖。
- `revision()` 同步、无网络 I/O。返回不可逆的 opaque 版本，在账号、选择文件、授权或配置变化时改变；不得直接返回 token、登录标识或原始路径。不要每次查询都生成新版本。
- 注册表 `list()` 返回来源 id、展示名、路由与注册代际/版本。`read(id, revision, {signal})` 检查读取前后绑定一致性、取消以及响应形状，丢弃卸载或换号后的迟到结果。
- 需要按信号取消网络请求。即便生产方不协作，注册表也会在取消时结束等待；它无法强制终止第三方自己的非协作 I/O。
- Usage Stats 只绑定没有原生适配器、没有显式 monitor 的路由。原生/显式适配器不被抢占；无法绑定时，以来源 id 新增独立额度监控项。
- 使用实际配置的 provider route，不假定它必然叫 `chatgpt`。

## 结果

```ts
{
  observedAt: 1800000000000, // epoch ms：该次结果的观测时间
  accounts: [{
    id: 'opaque-account-key',
    label: '用户自定昵称',
    plan: 'plus',
    status: 'ok',
    windows: [{
      id: 'primary',
      label: '5h',
      usedPercent: 25,       // 有限数字，0..100
      windowSeconds: 18000,
      resetsAt: 1800003600000 // epoch ms，可缺省
    }]
  }]
}
```

账号状态为 `ok | not-configured | unauthorized | rate-limited | unavailable | invalid-response`。无选择账号返回空数组；故障不能变成 0%/0 余额。账号可带 `stale: true`、`retryAt`（epoch ms）及固定安全原因码。允许原因码见类型文件；禁止原始错误文本。

- 账号 id 必须是不透明的本地键，不能使用真实 account_id、email、token 或登录 subject。
- `observedAt` 应是窗口实际成功观测时间；供应方返回旧窗口时必须 `stale: true`，保留旧时间。没有旧窗口的失败结果可使用失败观测时间。
- `usedPercent` 不可缺失、NaN 或越界。缺少可用窗口不是 fresh zero。
- 主/次窗口互不相加，也不换算 token、金额或次数。消费者计算 `remainingPercent = 100 - usedPercent`。
- 只有时长确实为 604800 秒才映射为 weekly，secondary 不必然代表一周。
- 消费者保留每个窗口的账号标签；多账号部分失败须可见，不掩盖失败账号。
- 未声明字段会被投影丢弃；供应方仍有责任不把秘密塞进 label/plan 等允许的字符串字段。

## 缓存与生命周期

账号缓存键包含注册表身份、注册代际与生产方 revision。来源注销/重载后不得复用旧余额。绑定在读取中变化时，不保留旧账号的 stale 回退。服务正常但暂时查询失败，可以展示此前同一绑定的旧窗口，明确标记 stale 与成功时间。

现有 Usage Stats 刷新策略统一调度，生产方不必另起轮询器。注册变动会失效额度缓存并通知调度器。429 使用现有 rate-limited backoff；`retryAt` 是可选结果元数据，当前调度器尚不使用它覆盖标准 backoff。

## 安全与验收

不得发送凭据、授权文件内容、原始响应、真实账号 ID、敏感 URL、请求头或任意错误给消费方。凭据路径选择/授权属于用户操作，不提供可由 agent 自行授予权限的工具。

回归：`npm run test:quota`。

跨仓库真实 Cordis 联调（先在 ChatGPT 仓库执行 `npm run build`）：

```sh
node scripts/test-quota-integration.mjs /absolute/path/to/dsh-plugin-chatgpt
```

该测试运行真实 Cordis、ChatGPT 生产注册路径与 Usage Stats 消费者，仅替换供应商网络为合成响应，不读取真实账号。它不等同于已安装 profile 的 UI 验收或真实账号对账。

Codex 卡片自动保存的真实 React 合成验收（需要两个仓库已安装其声明的开发依赖）：

```sh
node scripts/test-autosave-integration.mjs /absolute/path/to/dsh-plugin-chatgpt
```

覆盖初始化不授权、600ms 防抖、授权即时写入、请求顺序、失败重试、查询前保存、停止时取消待写入以及组件卸载提交。不会读取真实授权文件或访问供应商。组件卸载提交是尽力执行；关闭/刷新整个浏览器前应等待自动保存成功。
