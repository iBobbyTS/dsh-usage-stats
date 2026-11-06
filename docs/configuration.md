# Configuration

### Provider monitoring in the model picker (fork)

This fork adds a compact quota/balance readout **beside the DSH model selector** through the native `conversation.input.right` slot. The value follows the current session's selected *route*, not the model vendor. The readout uses the existing server-side account cache and never exposes API tokens. For quota accounts the leading mark is a concentric ring gauge: one ring per window, the innermost ring the shortest period and every ring outward a longer one, each arc showing that window's remaining share (at most 5% red, at most 20% amber, otherwise green). More than three windows drop the shortest periods; windows that report no denominator keep the plain `◉` mark; balance accounts show no mark at all. The percentage text is always shown.

In **Settings → Models**, each configured Provider card contains a **Balance / quota monitoring** section. Choose the *actual backend* (Automatic, NewAPI, Sub2API, OpenCode Go, Z.ai, etc.), select the displayed metric (Balance, 5-hour/Session, Daily, Weekly, Monthly, Total quota, MCP), optionally override the HTTPS usage API Base URL, and optionally reference a credential name already configured in DSH. Leave both overrides empty to use the route's configured URL and key. Setting either override stops borrowing the other route-owned value; fixed vendor or plugin-canonical endpoints can still be used. See the [complete pairing rules](#覆盖配对规则) for these exceptions. Settings save automatically, independently of the model editor: choices save immediately; text saves after 600 ms of inactivity or on blur. Saving does not disable editing. Failed writes keep the draft and show an error; edit again or leave the field to retry. Wait for the saved status before closing or refreshing the browser. A route called `zai` that actually uses NewAPI should explicitly select **NewAPI**. Unsupported or unavailable selected windows show a neutral dash rather than fabricated values.

Options are persisted under `$DSH_HOME/storages/usage-stats-provider-options.json`, distinct from inference-provider configuration. Only adapter names, selected metrics, endpoint URLs, and credential **reference names** are saved; token values never enter the file. The Host exposes `GET /api/usage-stats/provider-options?provider=<id>` and a loopback-only, action-header protected `POST /api/usage-stats/provider-options` to the settings UI; credential values remain on the Host. A Host restart is required after installing/upgrading the plugin; saving provider options within an already-running Host takes effect immediately.

The Models extension uses DSH's keyed `settings.models.provider-card` slot. It is attached to Provider cards, not injected into the native model editor's internal field list; this avoids overriding DSH's own form. The setting applies per route, so several routes sharing `llm-pi-ai` can select different backends.

The promotional provider integration, auto-install preset, and the associated wallet adapter are no longer part of this fork.




## 支持的账户类型 / Providers

插件自动发现官方 DeepSeek API Key 路由、DSH 0.2 的 `deepseek-account` 路由，以及 `llm-pi-ai` 中的 provider profile。只有存在公开账户接口、Host-owned account service 或显式 monitor 的供应商才会查询账户；Token 用量统计不需要额外凭据。

> **DSH 0.2 Desktop**：`0.3.5` 已支持 Host-owned `deepseek-account` 登录余额；该路径依赖 DSH `0.2.0-rc.2+` 的 account service，不读取原始 token、Cookie 或 PKCE。旧版 Harness 与 API Key DeepSeek 仍继续使用 `/user/balance` 路径。

| Provider / adapter | 模式 | 默认凭据 | 上游接口 |
| --- | --- | --- | --- |
| DeepSeek API Key | 余额 | provider `apiKeyEnv` | `/user/balance` |
| DeepSeek Account（DSH 0.2 Desktop） | 余额 | DSH Host-owned account grant；插件不读取 token/cookie | `deepseekAccount.getState()` + `getBalance()` |
| OpenRouter | 余额 | `OPENROUTER_MANAGEMENT_KEY` | `/api/v1/credits` |
| Moonshot / Kimi API | 余额 | provider `apiKeyEnv` | `/v1/users/me/balance` |
| OpenCode Go | 订阅 | `OPENCODE_API_KEY`，兼容旧 `OPENCODE_GO_API_KEY` | `/inference/go/v1/usage`（兼容旧 `/zen/go/v1/usage`） |
| Z.ai / 智谱 | 订阅 | 全球区 `ZAI_API_KEY`；中国区 `ZAI_CODING_CN_API_KEY` | Coding Plan quota/subscription |
| Kimi For Coding | 订阅 | `KIMI_API_KEY` | `/coding/v1/usages` |
| MiniMax Coding Plan | 订阅 | 全球区 `MINIMAX_API_KEY`；中国区 `MINIMAX_CN_API_KEY` | `/v1/token_plan/remains` |
| Ollama 云 | 订阅 | `OLLAMA_API_KEY` | `/api/usage`（5小时 + 周窗口） |
| Command Code（Go / GOAT / Pro / Max） | 订阅 + 余额 | `COMMANDCODE_API_KEY` | `/alpha/billing/credits` 等 `/alpha/*`（**实验性**：未公开端点） |
| 火山方舟个人 Coding Plan（可选 CLI，实验性） | 订阅 | 明确指定的官方 Ark CLI profile，独立于模型 API Key | `arkcli usage plan --product coding-plan` |
| New API | 余额 | provider 推理 Token | `/api/usage/token/` |
| Sub2API / Passion | 自动判别 | provider `apiKeyEnv` | `/v1/usage` |
| Sub2API 面板（真实） | 余额 | provider 推理 Token | `/user/balance`（复用 apiKey） |
| CodeArts 系反代（`dsh-codearts-auth`） | 订阅 | 宿主插件账号池；本插件不读取 AK/SK | `creditBalance.creditsBalances()`（进程内） |
| General / Declarative | 余额或订阅 | 配置中的 credential ref | 受限 GET + JSON |

DSH 注册表仅返回路由 ID、未提供连接字段时，`minimax` 默认读取 `MINIMAX_API_KEY` 并请求全球区，`minimax-cn` 默认读取 `MINIMAX_CN_API_KEY` 并请求中国区。两条默认凭据不会互相回退。显式 `credentialRef` / provider `apiKeyEnv` 仍优先，引用缺失时不会借用默认 Key；自定义路由、provider endpoint 或自定义 `usageBaseURL` 不会自动继承这些凭据。这里显示的是 Coding Plan 订阅额度，不代表支持任意 MiniMax API 钱包余额或 Providers Hub 的 MiniMax Code 账号池。

MiniMax 区域优先级为 `monitors.<id>.region` > `MINIMAX_API_REGION` > route/baseURL/credential ref 推断。中国区与全球区凭据请匹配相应区域；明确区域的请求不会因 1004/2049 拒绝而切到另一区域，显式 `usageBaseURL` 仍只访问指定地址。

没有公开账户接口的供应商仍会正常统计 Token；账户卡片会明确显示“不支持”，不会猜测余额。

### 火山方舟个人 Coding Plan（实验性）

可选择通过[官方 Ark CLI](https://github.com/volcengine/ark-cli)读取个人套餐额度。先自行安装、登录 CLI，并用明确指定的 profile 验证 `usage plan --product coding-plan --profile <name> --format json` 能正常返回。插件只支持个人 `coding-plan`，不把后付费 Token 统计当作套餐余额，也不读取团队席位或 BytePlus 账户。

```yaml
        monitors:
          ark-coding-plan-cn:
            adapter: ark-coding-plan-cli
            arkCLIExecutable: /absolute/path/to/arkcli-darwin-arm64
            arkCLIProfile: personal-coding
```

`arkCLIExecutable` 必须是官方安装中的**原生二进制文件**绝对路径（npm 包的 `bin/arkcli-<platform>-<arch>`，Windows 为 `.exe`），不要填写 npm 的 Node 启动脚本或 `.cmd` 包装器。这样超时会终止实际查询进程，不会遗留包装器启动的子进程。`arkCLIProfile` 必须明确指定，限制为 1–64 个字母、数字或 `_ . -`，首字符为字母或数字。CLI 的控制面登录身份与 DSH 模型 Key 不等价，请选择自己的正确账户。

后台只执行上述只读查询，不自动安装或下载 CLI，不调用登录、购买、续费、轮换 Key 或切换默认 profile。CLI 负责其已有认证态的正常维护及网络访问；这是一个明确启用的本机进程边界，**不经过插件 HTTP 适配器的 DNS/IP 固定逻辑**。使用非交互 stdin、15 秒超时和 1 MiB 输出上限，且不传递继承的 `ARK_API_KEY`、`ARK_PROFILE` 等凭据覆盖。账户快照仅包含归一化的 session/weekly/monthly 已用比例和重置时间，不包含 CLI 的 viewer、账户标识、原始错误或认证文件。缺少文件、未订阅、命令失败或未知响应都有明确的非正常状态，不填零冒充成功。

已核对官方 CLI 1.0.40 的命令参数，并于 2026-10-29 复核 [1.0.45 官方契约](https://github.com/volcengine/ark-cli/blob/b84d1c02c3e3dc024b1b927f37dd39858053ea82/skills/arkcli-usage/references/arkcli-usage-plan.md)。默认不启用，仅在用户显式配置以上 monitor 后执行；脱敏样例和失败路径通过回归，尚无真实个人套餐账户验收。可作为实验性适配器使用，#74 仍保留账户验收待办。

### 跟随当前主会话（可选）

面板的“跟随当前会话”默认关闭，升级保留已有手动选择。显式开启后，只跟随主视图会话中已确认、可路由的模型供应商，按完整 route id 匹配账户卡片；同品牌的多个账号不会合并。自动选择不覆盖最后一次手动选择；手动选卡片立即退出跟随，关闭开关则恢复有效的手动选择。

此功能要求客户端提供可订阅的会话列表和模型目录；缺少能力、会话未确定、模型尚在提交、目录失败或没有精确账户匹配时，显示状态说明并继续使用手动选择。不做周期性模型/额度轮询，不强制上游刷新；它跟随的是路由，不识别一个路由内部轮换的账号池。详见[使用说明](follow-current-session.md)。

## 凭据与供应商配置 / Configuration

凭据由 Harness 从 `~/.dsh/.credentials.yaml` 解析。安装器不会读取、创建或修改该文件。不要把真实 Key、Cookie 或管理令牌提交到 Git、公开 issue，或粘贴给编码 Agent。

### 账户刷新 / Account refresh

默认刷新间隔是 active 1 分钟、detail 2 分钟、background 15 分钟。严格限流的 New API 或公司中转可以调整全局策略，或完全关闭账户自动刷新：

```yaml
# ~/.dsh/profiles/web/cordis.patch.yml
- insert:
    - id: usage-stats
      name: "@ychris12138/dsh-usage-stats"
      config:
        refresh:
          enabled: false
          activeMs: 60000
          detailMs: 120000
          backgroundMs: 900000
```

三个间隔必须是 `60000` 至 `86400000` 毫秒之间的整数。需要停止时使用 `refresh.enabled: false`，不要填写超大的 timeout。关闭后，每个相同 provider 配置仍允许首次查询；之后普通面板读取只返回缓存，不会因缓存过期访问上游。账户端点的 `refresh=1`（Retry）仍可显式刷新，provider/monitor 配置变化后也会为新配置重新查询一次。

旧配置 `disableBackgroundRefresh: true` 继续等价于 `refresh.enabled: false`；两者同时存在时，显式的 `refresh.enabled` 优先。该开关只关闭账户上游自动刷新，不会关闭本地 Token 用量聚合。

### 估算费用与预算 / Estimated cost and budgets

预算是可选的非敏感配置，默认关闭。金额只在 provider、model、事件时间与货币均能由内置价格规则可靠确定时计算；未知中转、订阅路线、无价格的 cache write 或混合币种会整体显示 `—`，不会展示部分费用或进行汇率换算。

```yaml
# ~/.dsh/profiles/web/cordis.patch.yml
- insert:
    - id: usage-stats
      name: "@ychris12138/dsh-usage-stats"
      config:
        budgets:
          currency: USD
          daily: 5
          monthly: 100
```

预算使用本机日历日/月边界：低于 80% 为正常，达到 80% 为 warning，达到 100% 为 critical。`daily` / `monthly` 必须是正数或 `null`；当前版本不做 FX 换算，因此预算货币与可靠价格货币不兼容时状态保持 unknown。

面板的当前 provider 会保存在浏览器的命名空间 localStorage 中；刷新页面或重启 DSH 后恢复。若该 provider 已被删除，插件会清除旧值；DSH 0.2 Desktop 已登录时优先选择 `deepseek-account`，否则回退到已配置的 `deepseek-official` / 其他 provider。默认使用已有的有效手动选择；仅在显式开启“跟随当前会话”时允许自动切换。该选择不会写入 DSH 设置、服务端缓存或新 API。

### DSH Desktop DeepSeek Account（DSH 0.2）

DSH 0.2 将浏览器登录的 DeepSeek Account 与 `deepseek-official` API Key 路由分开。插件通过 Host 的可选 `deepseekAccount` service 读取**客户端安全的登录状态和余额结果**，不会读取或复制账号 token、Cookie、PKCE 数据，也不会把它们发送到浏览器。

- `deepseek-official`：继续使用 `DEEPSEEK_API_KEY` / `/user/balance`，兼容旧 Harness；
- `deepseek-account`：使用 Desktop/Settings 已保存的账号 grant，通过官方 Host service 查询；
- 充值余额与赠送余额按币种合并；CNY 与 USD 同时存在时**分别显示，绝不跨币种相加**；
- Host Account 不参加后台账户轮询。只有带真实 UI 版本/语言/时区 metadata 的面板读取才会查询余额；退出或切换账号后，下一次 UI 读取不会继续复用旧余额；
- Host 账户服务动态获取，服务晚加载或重载后可自动恢复；服务替换、移除或退出登录后不复用此前余额。Desktop 更新插件后若服务端尚未重新加载，需要重启 Desktop Host，单独刷新窗口不能替代服务端重载；
- 未登录显示“未登录 DeepSeek Account”，不会误提示用户配置 `DEEPSEEK_API_KEY`。

### CodeArts 系反代供应商（dsh-codearts-auth）

**实验集成，当前官方包不可用**：2026-10-29 校验的公开 npm `2.9.261029` 仍不提供 `creditBalance` 服务，上游服务 [PR #9](https://github.com/iJetLi/dsh-providers-hub/pull/9) 也已关闭且未合并。旧源码/运行包补丁仅适用于各自精确基线，不能直接用于新版，也不代表正式支持。见[当前阻塞与历史配套构建说明](https://github.com/iBobbyTS/dsh-usage-stats/blob/main/integrations/providers-hub/README.md)。后续须先明确上游接受的脱敏服务边界与受支持构建，再完成真实隔离 profile 和账户对账。

`deepseek-harness-codearts` 的账号池路线包括 `codearts` / `buddy` / `workbuddy` / `lobsterai` / `qoder` / `qodercn` / `trae` / `cline` / `loomy` / `raccoon` / `zcode`，以及与内置供应商同名的 `minimax`。这些账号池路线的凭据由宿主插件持有，因此使用进程内余额接口。

宿主配套通过 `ctx.provide('creditBalance', service)` 提供以下接口：同步的 `supportedProviders()` 返回 `{ id, displayName? }[]`，异步的 `creditsBalances(providerId)` 返回 `{ accounts: [{ accountId, nickname?, balance, error? }] }`。仅有 `accountPool` 或内部 `credits.balances` RPC 不满足此契约。

2026-10-20 已对[上游](https://gitee.com/iJetLi/deepseek-harness-codearts)当前源码与 npm `1.9.261020` 分别制作配套候选包，并在解包后通过真实 Cordis/宿主余额分派与本插件的联调。供应商取数使用合成读数；真实账户对账仍待完成。安装 Usage Stats 不会自动修改已安装的 Providers Hub。标准 MiniMax Coding Plan 不依赖这项实验集成。

本插件经 `ctx.get('creditBalance')` 读取服务计算的 `CreditBalance`。服务清单只补充不存在的 provider，并为这些条目标记明确的宿主来源；不会覆盖已注册的同名路由。裸 `minimax` 仍按内置 MiniMax token plan 查询，缺少 `apiKeyEnv` / `baseURL` 不能证明它属于 CodeArts。

新增渠道名如 `gemini`、`modelscope` 也可能属于独立 API 供应商，不能仅凭名字将其归入宿主账号池。服务新增的条目可依来源标记识别；既有同名路由需显式配置 `codearts-credits`。徽章简称不构成账户或定价归属证据。

若已注册的 `minimax` 实际使用 CodeArts 账号池，需要在现有 usage-stats 配置下显式选择适配器：

```yaml
monitors:
  minimax:
    adapter: codearts-credits
```

- 数据所有权完全在宿主插件：本插件不读取、不复制、不转发 AK/SK、token、Cookie；只读余额结果与积分包元数据；
- 积分按**包**展示（每个包的已用比例与到期日），不压成单一余额数字——用户要看的正是「哪个包快过期」；
- 活跃包可由 `total - used` 补出缺失的剩余额度；只有 `remaining` 时显示绝对值，不猜百分比。所有分包都不可读而有有效汇总余额时使用汇总，不叠加重复统计；
- 过期包可保留已知的历史消耗比例，但不参与当前剩余额度告警或侧栏最低额度。缺失金额显示 `—`；
- 宿主响应缺少 `accounts` 列表时报响应异常；标记 `stale` 的旧余额不作为新鲜额度展示；
- 宿主插件缺席时这些卡片显示“不支持”，不影响其余 provider，也不会让插件启动失败；
- 查询失败不会显示成 0；`reason` / `partial` 只包含固定安全原因码，不包含上游原始错误、失败账号的昵称或 ID。

### 余额型供应商

DeepSeek API Key、Moonshot 等默认复用对应 provider profile 的 `apiKeyEnv`。例如：

```yaml
# ~/.dsh/.credentials.yaml
DEEPSEEK_API_KEY: sk-your-key-here
```

OpenRouter 是明确的例外：官方账户 credits 接口要求 **Management Key**，不能复用普通推理 `OPENROUTER_API_KEY`。插件默认读取独立引用；未配置时显示“未配置”，不会拿推理 Key 试探：

```yaml
# ~/.dsh/.credentials.yaml
OPENROUTER_MANAGEMENT_KEY: sk-or-v1-your-management-key
```

插件按 `total_credits - total_usage` 显示 OpenRouter 余额，并同时展示累计已用和总 credits。普通 Key 的 `/api/v1/key` 只描述单个 Key 的 spending limit，不会被当作账户余额。自定义引用可在 `monitors.openrouter` 中设置 `adapter: openrouter-balance` 与 `credentialRef`。



### Token Plan 供应商

```yaml
# ~/.dsh/.credentials.yaml
OPENCODE_API_KEY: sk-opencode-your-key
ZAI_API_KEY: your-zai-key
# 中国区 Z.ai 用户可选；默认 global
ZAI_API_REGION: bigmodel-cn
KIMI_API_KEY: your-kimi-key
MINIMAX_API_KEY: your-minimax-key
# 中国区 MiniMax 用户可选；默认 global
MINIMAX_API_REGION: cn
# DSH 中国区 minimax-cn 路由默认使用此凭据名
MINIMAX_CN_API_KEY: your-minimax-cn-key
OLLAMA_API_KEY: sk-ollama-your-key
COMMANDCODE_API_KEY: user-your-command-code-key
```

OpenCode Go 原生路由先读取当前 DSH 使用的 `OPENCODE_API_KEY`，缺少时才兼容旧 `OPENCODE_GO_API_KEY`，然后尝试旧版 OpenCode 的 `~/.local/share/opencode/auth.json`，最后才使用显式 `OPENCODE_GO_AUTH_COOKIE + OPENCODE_GO_WORKSPACE_ID` 兼容回退。显式 monitor/provider credential ref 始终优先，缺失时不借用本地文件或其他账户的凭据。先访问官方迁移后的 `/inference/go/v1/usage`，仅在 404/405 时用同一密钥尝试旧路径；401/403/429 不重试或更换密钥。Bearer usage endpoint 仍不是稳定的公开 API。

若账户卡片显示「未配置」，说明未找到凭据，还未发起额度查询。OpenCode V2 的凭据存储不再等同于旧 `auth.json`；已登录 OpenCode 不代表 DSH 已配置密钥。请在 DSH 的 OpenCode Go 模型设置中配置自己的 Console API Key，或在 DSH credentials 中配置上述引用。不要导出 OpenCode 的凭据数据库或把密钥、Cookie 贴到 issue；本插件不会扫描或解密 V2 凭据数据库。

也可以使用官方 Console 查看账户额度，或用 OpenCode 的 `stats` 查看该客户端的本地 token/费用；数据范围与限制见 [OpenCode 用量来源](opencode-usage-sources.md)。Providers Hub 的 OpenCode 通道可用数不作为 Go 额度显示。

Cookie 路径仅在没有选中任何 API Key 时使用；已选中的 Key 查询失败，不会再切换到 Cookie 所属的另一账户。

Ollama 云读取 `OLLAMA_API_KEY`，调用 `/api/usage` 展示两个订阅窗口（5 小时会话 + 每周），无余额；`usage` 按 0..1 比例换算为进度条。

Ollama 适配器只对**已配置的 provider** 生效，不会自动添加账户：当 provider 的 id 为 `ollama`，或其 baseURL 主机为 `ollama.com`（含子域）时自动选用；本地 Ollama（`localhost:11434`）不会被当作云配额账户。特殊代理/自定义端点可用显式 monitor 绑定：

```yaml
# ~/.dsh/profiles/web/cordis.patch.yml
- insert:
    - id: usage-stats
      name: dsh-usage-stats
      config:
        monitors:
          relay-ollama:            # 你配置的 provider id
            adapter: ollama
            usageBaseURL: https://ollama.example.com
            credentialRef: OLLAMA_API_KEY   # 非已配置 provider 时必填
```

**Command Code（Go / GOAT / Pro / Max）——实验性适配器。** 它读取 `COMMANDCODE_API_KEY`，调用的是 Command Code 自己 CLI 使用的一组**未公开、未版本化**端点（不属于其公开 Provider API）：`/alpha/billing/credits` 给出 credits 与 5 小时/每周窗口，`/alpha/usage/summary` 给出本期请求数与花费，`/alpha/billing/subscriptions` 给出档位（Go / GOAT / Pro / Max）与计费周期。上游随时可以改动或收紧这些端点，届时卡片会退化为「响应异常」，不会影响 Token 统计本身。卡片因此显示**三条窗口**——5 小时、每周、每月（每月的重置时间就是订阅周期结束时间）——外加一行 credits 美元余额，这是本插件里唯一一张余额与订阅窗口并存的卡片。

三条窗口的口径：5 小时与每周按上游直接给出的「已用金额 ÷ 上限」换算；月度池只用它**自己那一对**数字——`credits.monthlyCredits`（月度池剩余）与 `/alpha/usage/summary` 的 `totalMonthlyCredits`（本期从月度池花掉的部分）——作为分母的两半（推导值）。充值 `purchasedCredits` 与赠送 `freeCredits` 是**另外两个池**：它们只出现在余额行与 breakdown 里，不进月度窗口的分母；聚合的 `totalCredits` 同样不进，若 `totalMonthlyCredits` 缺失就干脆不画月度窗口，而不是拿聚合值凑一个分母。

只有 credits 端点决定查询成败，另两个端点失败只会少显示档位、本期花费，以及需要它们的推导项：月度窗口要 `totalMonthlyCredits`，余额行的「已使用/总余额」要聚合 `totalCredits`——缺哪项就少哪项，而不会把未知当成 0 余额。字段缺失一律按“没有这项”处理，形状完全无法识别时返回 `invalid-response` 并带上安全的原因码，而不会把未知当成 0 余额。

这些端点会按**客户端版本**放行，所以适配器自带一个默认版本（随本插件发布更新）；某个部署被要求更高版本时，用 monitor 覆盖即可，不需要等发版，也不会在每次刷新时去 npm 查询版本：

```yaml
        monitors:
          commandcode:
            adapter: commandcode-goat
            commandCodeVersion: 1.72.1   # 非空版本串；留空或自由文本会被拒绝
```

Provider 识别：id 为 `commandcode`、`commandcode-goat-autosync` 等 `commandcode-` 前缀（同步插件为每个档位与协议生成一条路由），或 baseURL 主机为 `*.commandcode.ai` 时自动选用 `commandcode-goat` 适配器，聊天基地址 `…/provider/v1` 会自动折算回账户根地址。由 provider 插件注册的 route 在 Harness 路由表里只有 id 与名称、不带 `apiKeyEnv`，这类 route 会用 `COMMANDCODE_API_KEY` 作为凭据引用（显式 `credentialRef` 仍优先），否则它会停在「未配置」而从不发请求。

需要说明的依赖关系：本适配器不 import 任何 provider 插件，额度数据也直接取自 `api.commandcode.ai`，但它沿用 **Command Code provider 插件发布的 route id 约定与默认凭据名**（`commandcode*` / `COMMANDCODE_API_KEY`）——与本插件对 Z.ai、Kimi、MiniMax、Ollama、OpenRouter 的默认凭据名做法一致。换用别的 provider 插件、或改了那个环境变量名时，写一行 `monitors.<id>.credentialRef` 覆盖即可，不需要改代码。

与 OpenCode Go、Z.ai 一样，没有任何 Command Code 路由的安装也会看到一张「未配置」的占位卡片；Command Code 是转售上游模型，它的路由不参与本插件的模型价格估算。

Z.ai 全球区使用 `api.z.ai`，中国区使用 `open.bigmodel.cn`。MiniMax 优先使用官方 `www.minimax.io` / `www.minimaxi.com` Token Plan 地址，并解析 5 小时与周窗口的剩余比例和重置时间。

DSH 0.2 的 provider registry 可能只提供 `zai-coding-cn` 的 route id，而不再附带 `apiKeyEnv` 或 `baseURL`。当没有显式凭据引用且查询中国区时，插件优先读取 DSH 使用的 `ZAI_CODING_CN_API_KEY`，缺失时兼容旧的 `ZAI_API_KEY`；两者同时存在时使用前者。显式 `monitors.<provider>.credentialRef` 优先于 provider 的 `apiKeyEnv`，指定引用缺失时不会改用其他 Key，上游拒绝凭据时也不会轮换 Key 重试。自定义 provider 不会借用这些默认凭据。

DSH 0.2 把模型页的路由档案保存在活动插件配置（cordis patch 层）里，settings 服务只暴露各 entry 的生效表单值。插件通过 settings forms 的 `describe()` 读取 `llm-pi-ai` 条目的生效 `providers` 档案，恢复每条路由自配的 `baseURL` 与 `apiKeyEnv`；路由在模型页存储的 API Key（scoped record `llm-pi-ai/<route>`）同样作为该路由自己的 Key 参与回退，优先于环境变量名。

### 覆盖配对规则

供应商卡片上的「余额接口 Base URL」与「查询凭据引用」是一对。两者都留空时，查询自动回退到路由本身配置的 URL 与 Key（模型页档案 / scoped record / `apiKeyEnv`，以及适配器内置端点与凭据别名）。填写任意一个后，另一侧不再自动回退——防止把路由自己的 Key 发到自定义查询地址（或反之）；此时另一侧也必须显式填写，否则该监控停在「未配置」而不发请求。例外：适配器自带固定厂商端点（Token Plan 类）不向 provider 借用任何配置，仅填凭据引用仍可查询厂商端点；插件内置的规范端点（如 `api.deepseek.com`）同理可借用。

区域设置沿用 `monitors.<provider>.region` > `ZAI_API_REGION` > route/baseURL 推断的顺序，`zai-coding-cn` 默认请求中国区。若区域被覆盖为全球区，默认凭据只读取 `ZAI_API_KEY`，不会把 `ZAI_CODING_CN_API_KEY` 发送到全球区；全球 `zai` 路由也不会隐式借用 CN 路由的 Key。供应商“已配置”状态、手动查询与后台刷新使用相同的凭据解析规则。

### New API、Sub2API 与自定义 monitor

在现有 `name: "@ychris12138/dsh-usage-stats"` Cordis entry 下合并 `config`，不要追加第二个插件 entry。monitor 键必须是 Harness 中真实存在的 provider id；未知 provider、adapter 或非法映射会在路由和 timer 注册前阻止插件启动。例外：monitor 同时显式提供 `usageBaseURL` 与 `credentialRef` 时视为自包含，会在 provider 注册可见前临时物化为 provider（适用于 Harness 设置页里后加载的 provider），此时不要求该 provider 已出现在注册表中。

<details>
<summary><strong>展开 monitor 配置示例</strong></summary>

New API 默认用 provider 推理 Token 查询 `/api/usage/token/`，只使用响应中 `data.user_quota.total_available` 展示账户余额，并从 `/api/status` 读取实例自己的 `quota_per_unit` 与币种换算配置。需要在 New API 的 API Key 设置中开启「允许查询用户额度」；未返回有效账户余额字段时不显示余额，不会回退到 Token 自身额度。Token 的不限额标记与有效期不代表账户余额属性：

```yaml
# ~/.dsh/profiles/web/cordis.patch.yml
- insert:
    - id: usage-stats
      name: "@ychris12138/dsh-usage-stats"
      config:
        monitors:
          relay-a:                 # Harness provider id
            adapter: new-api
            # 仅旧实例的 /api/user/self 回退需要：
            fallbackCredentialRef: RELAY_A_MANAGEMENT_PAT
```

只有 `/api/usage/token/` 返回 404/405 且配置了独立管理 PAT 才会 fallback；不会把推理 Token 当管理凭据。旧实例需要 User ID 时可增加 `fallbackUserIdRef`。

CC Switch 风格通用余额：

```yaml
        monitors:
          relay-a:
            adapter: general
            warning:
              warnBelow: 5
              criticalBelow: 1
```

Sub2API 风格 `/v1/usage`：

```yaml
        monitors:
          relay-a:
            adapter: sub2api
            warning:
              warnBelow: 5
              criticalBelow: 1
```

> 注意：`sub2api` 适配器对应一部分 Sub2API 部署暴露的 `/v1/usage` 协议。真实 Sub2API 面板（Wei-Shaw/sub2api 系）不提供该公开接口，改用 `sub2api-auth` 适配器读取面板自己的余额（见下）。

**真实 Sub2API 面板余额（`sub2api-auth`）**：Sub2API 面板把上游订阅统一暴露成 API，但上游供应商通常没有公开余额接口。`sub2api-auth` 用 provider 自己的推理 API Key 查询面板余额，同 CC Switch 的 General 模板：`GET {baseUrl}/user/balance`，`Authorization: Bearer {apiKey}`，读取 `body.balance`。**无需单独的面板凭据** —— provider 在 DSH 模型页里配置的那个 API Key 会被直接复用：

```yaml
        monitors:
          relay-b:
            adapter: sub2api-auth
```

（可选）若 `/user/balance` 返回 UTF-8 金额对应 `body.unit`，会显示该币种；否则默认 USD。今日已用额度尽量从 `GET /api/v1/usage/stats?period=today` 的 `total_actual_cost` 补充，查询不到也不影响余额展示。

**自动识别真实 Sub2API 面板（`sub2api-auth`）**：只要把 Sub2API 面板作为普通 provider 配置进 DSH（带入它的 API Key），插件会探测该 provider 的 `GET /api/v1/settings/public`。若指纹命中真实 Sub2API 面板（返回 `data.affiliate_enabled: boolean`），就自动按 `sub2api-auth` 用该 provider 的 API Key 读取余额，**无需为该 provider 单独写 `adapter`，也无需额外凭据**。显式 `adapter` 始终优先于自动识别；没有配置 API Key 的 provider 绝不会被探测。

```yaml
# 只要这些（不需要单独的 SUB2API_* 凭据）
# DSH 模型页里为 Sub2API 面板配置 provider，baseURL 指向面板，API Key 填可用的密钥
```

Passion（provider id 为 `passion` 或域名为 `*.passionapi.com`）会自动识别。钱包响应显示余额；`quota_limited` 或包含 `subscription` 的响应自动切换为额度窗口。

声明式自定义查询只支持受限 GET + JSON Pointer，不执行 JavaScript：

```yaml
        monitors:
          private-model:
            adapter: declarative
            mode: balance
            request:
              path: /account/balance
              auth:
                type: bearer
                credentialRef: PRIVATE_MODEL_API_KEY
            extract:
              root: /data
              remaining: /available_balance
              used: /used_balance
              total: /total_balance
              currency: /currency
```

若余额接口只接受查询参数认证，可用 `auth.type: query`，让 Host 在发请求时从凭据引用注入密钥：

```yaml
        monitors:
          aiflashapi:
            adapter: declarative
            usageBaseURL: https://api.aiflashapi.com
            mode: balance
            request:
              path: /stats/balance
              auth:
                type: query
                param: key
                credentialRef: AIFLASHAPI_API_KEY
            extract:
              root: /data
              remaining: /balance_cny
              currencyValue: CNY
```

`param` 为 1–64 个字符，以字母或 `_` 开头，后续允许字母、数字、`_ . -`；query auth 只接受 `type`、`param`、`credentialRef`。密钥保存在 DSH credentials 中，不得写入 `request.path`、base URL 或 headers。配置中的同名认证查询参数（包括编码后的同名项）、path fragment，以及 base URL 的查询串或 fragment 均拒绝；其他非敏感 path 查询参数会保留。缺少凭据时不发请求，且沿用 HTTPS、同源、DNS/IP 校验、禁跟随重定向和响应大小限制。上游在套餐名、币种或额度标签等快照字段中回显凭据原值或 URL 编码值时，查询返回固定的 `invalid-response`，回显内容不会写入账户缓存。既有 `bearer`、`raw`、`x-api-key` 配置继续有效。

查询参数认证会让目标服务及其 TLS 终止代理看到含密钥的请求 URL；插件无法保证第三方访问日志不记录它。若接口支持请求头认证，优先选择请求头。

</details>

支持的 adapter：`deepseek-balance`、`deepseek-account`、`openrouter-balance`、`moonshot-balance`、`zai-balance`、`opencode-go`、`commandcode-goat`、`zai-token-plan`、`kimi-token-plan`、`minimax-token-plan`、`ollama`、`ark-coding-plan-cli`、`codearts-credits`、`new-api`、`sub2api`、`sub2api-auth`、`general`、`declarative`。

`warning.warnBelow` 与 `warning.criticalBelow` 是余额绝对值阈值。具有总额度的余额和 Token Plan 会自动产生 `normal / warning / critical` 剩余比例状态（默认 30% / 10%）。
