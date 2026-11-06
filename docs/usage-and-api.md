# Usage and API

## 使用 / Usage

1. 点击侧边栏“用量/余额”。
2. 用“当前供应商”切换账户卡片；一次只显示一个 provider。
3. 使用 `‹` / `›` 切换月份，点击热图日期查看当天的 provider/model 明细。
4. “最近会话费用”只显示 `costComplete=true` 的完整估算；未知价格或混合币种会话不会展示误导性的部分金额，完整 session 数据仍可通过 CSV/JSON 导出。
5. 标题栏刷新会更新 Token、provider 列表，并强制刷新当前账户。

### 安全导出 / Secret-free export

三个下载端点只导出聚合后的白名单字段，不包含 credential ref/value、Authorization、Cookie、上游原始响应、prompt/reply 或文件路径：

- `/api/usage-stats/export/daily.csv`：每天 × provider/model 的四类 Token 与完整费用估算。
- `/api/usage-stats/export/sessions.csv`：session 标题、provider/model 集合、Token、完整费用估算和最后活动时间。
- `/api/usage-stats/export.json`：带 `schemaVersion` 的完整聚合数据、公开 pricing provenance、预算和安全账户状态。

CSV 使用 UTF-8、RFC 4180 引号与 spreadsheet formula 防护；Unicode 标题可直接打开。费用只在 `costComplete=true` 时导出，未知/混合币种保持空白或 `null`，不会输出部分金额。

“最近 14 天”按本地日历计算，只显示窗口内存在用量的日期；未来时间戳不会计入。同一模型来自不同 provider 时会分别统计，例如 `deepseek-official · deepseek-chat` 与 `ark · deepseek-chat`。


## 隐私与安全 / Privacy & security

- API Key、OpenCode `auth.json`、Cookie 与管理 PAT 不会进入浏览器响应、插件缓存或日志。
- Sub2API `sub2api-auth` 复用 provider 自己的推理 API Key（模型页已配置的那个），不会再引入或落盘额外的面板凭据。
- 自定义 monitor 默认要求 HTTPS、同源相对路径、手动 redirect 和 JSON 响应，body 上限为 1 MiB。
- 发凭据前会筛选域名的 IPv4/IPv6 解析结果并固定一个允许的连接地址，优先使用公网地址；HTTPS 域名解析到 `198.18.0.0/15` 时可作为 Clash/Mihomo 等代理的 synthetic fake-IP 使用。字面量 `198.18/15`、其他私网/特殊地址仍默认拒绝，防止 DNS rebinding 绕过私网限制。
- `usageBaseURL` 禁止内嵌 username/password；`Authorization`、`X-API-Key`、`API-Key` 等 header 必须由 credential ref 注入。
- 数据读取与导出接口仅接受 GET；Provider 监控配置接口的 GET 仅读取非敏感设置，POST 写入设置并要求非简单自定义 action header。保存时序见[监控配置](configuration.md#provider-monitoring-in-the-model-picker-fork)。所有路由同时校验 peer socket 与 Host，支持 IPv4、IPv4-mapped IPv6 和 `[::1]:port`。
- 用量缓存 `~/.dsh/storages/usage-stats-cache.json` 只保存聚合 Token、会话 id、不透明 revision 与折叠游标，不保存提示词、回复或文件路径。

本机反向代理会让插件看到代理自身的回环地址。请勿把端点经反向代理暴露到局域网或公网；确需代理时必须在代理层增加可靠认证与访问控制。安全问题请按 [SECURITY.md](../SECURITY.md) 私下报告。

## 正确性与数据口径 / Correctness

Token 统计值来自 `assistant/chunk`、`assistant/message` 或 `compaction/summary` 中 provider-reported `usage`，不是本地估算。相同 turn/step 的后续样本会替换旧样本，并按 `provider/model` 归集。

费用是明确标注的估算派生值：每个 usage 样本使用自己的事件时间、原始 provider/model 与四类 token bucket 匹配 `lib/pricing.js`；替换样本会先减去旧费用，再加入新费用。绝不会用“当前价格 × 历史累计 Token”。每个 session 的派生费用继续进入 `usage.sessions`、session CSV、JSON export 与整体 billing aggregation；插件不会向 DSH composer 注入 session UI。

- 活跃会话只处理新追加事件。
- 持久化会话使用不透明 revision（Harness 的 `list()`；旧版 `listSnapshots()` 仍兼容）；未变化时不重复读取日志。
- 持久化日志通过 Harness 的 `open(id, "read")` 读句柄读取（旧版 `readFrom()` 仍兼容），每次读完立即关闭句柄。
- 持久化读取使用有界并发（4 个日志同时解码）：DSH 0.1.7 首次打开一个日志要解码并校验整个文件（约 0.5 s/会话），顺序读取大库会让一轮全量扫描耗时数分钟。
- 面板的高频读不会等待进行中的全量扫描：扫描期间直接返回**上一次已发布的整份快照**（总量与逐会话行同代，不会新旧混排），扫描结束后下一次读再更新，避免请求被拖到 HTTP 超时。
- 被后端**确定性拒绝**的存储日志（`SessionFormatUnsupportedError`、`SessionPersistenceCorruptionError`）在**本进程内**按 revision 记忆，日志变化前不再重试；瞬时错误不记忆，下一次扫描照常重试。两类失败每轮各汇总一条告警，且该记忆只存在于运行时、不写入缓存文件（重启后同一日志会重新尝试，因为拒绝取决于读取方而非日志本身）。
- 已退出 live store 的会话（例如已结束的 sub-agent 运行）在下一次聚合时按 id 补读持久化日志，其 Token 计入日/模型总量，无需等待后台全量扫描。
- seq 缺口、日志重写或 live/persisted 切换时完整重折叠该会话。
- **继承历史按用量证据去重**：支持新版 DSH live Session / 持久化 read handle 的精确 `inheritedEventCount`，或明确的 `session/end-seed` 标记。复制样本与原样本只汇总一次；父日志缺失或只保留部分样本时，唯一幸存副本继续计入。普通 fork 不必提供 parentSession，也不按日期猜覆盖。旧宿主若没有精确边界则保留原有计量，仍可能重复；不可读旧缓存也保留汇总回退，不能宣称已校正这部分历史。详见[计量边界与验收](pr153-accounting-review.md)。
- 空读取不等于空日志：已经折叠过的会话若读到 0 个事件，保留既有折叠且不记录 revision，下一轮继续重试；schema 升级改为**迁移**已有折叠而不是丢弃（日志压缩后，缓存是那段用量的唯一账本）。
- 聚合采用 single-flight，并在同一临界区原子保存缓存。
- `validate:live` 会逐会话比较 raw artifact、`session.history`、插件端点与官方 token projection；缺文件或不一致会返回非零。

## API

| Method | Path | Response |
| --- | --- | --- |
| `GET` | `/api/usage-stats/usage` | 按日期/provider/model 聚合的 Token、派生费用、session 明细与日/月预算状态 |
| `GET` | `/api/usage-stats/providers` | provider 列表、account mode、adapter、状态与预警摘要 |
| `GET` | `/api/usage-stats/provider-options?provider=<id>` | 当前路由的非敏感监控设置 |
| `POST` | `/api/usage-stats/provider-options` | 校验并保存监控设置；要求 action header，配置字段见[监控配置](configuration.md) |
| `GET` | `/api/usage-stats/account?provider=<id>` | 当前 provider 的统一余额或 Token Plan 快照；`refresh=1` 强制刷新 |
| `GET` | `/api/usage-stats/balance?provider=<id>` | `0.1.x` 余额兼容路由 |
| `GET` | `/api/usage-stats/subscriptions` | `0.1.x` Token Plan 兼容路由 |
| `GET` | `/api/usage-stats/session-context?session=<id>` | 当前 live session 的 route/model/account 与同一增量 fold 的 session 费用快照 |
| `GET` | `/api/usage-stats/export/daily.csv` | secret-free daily provider/model CSV |
| `GET` | `/api/usage-stats/export/sessions.csv` | secret-free session CSV |
| `GET` | `/api/usage-stats/export.json` | versioned usage、budget、pricing provenance 与 account-safe JSON |

除 `/api/usage-stats/provider-options` 的 POST 外，非 GET 返回 `405`；非回环请求返回 `403`。API JSON 使用 `Cache-Control: no-cache`；下载响应使用 `Cache-Control: no-store` 与固定文件名。


## Current compatibility

The current derived usage cache is schema **11**. A schema upgrade refolds readable logs while retaining unavailable aggregates until their source can be read. Exact live/read-handle `inheritedEventCount` takes precedence; the last inherited seed marker is a fallback only when that metadata is unavailable. See [accounting boundaries](pr153-accounting-review.md).

`display.currentSessionPill` remains accepted and controls the legacy `session-context` API response. It does not control the fork's model-picker quota component in `conversation.input.right`.
