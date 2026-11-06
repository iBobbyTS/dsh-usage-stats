# dsh-usage-stats

<!-- stable-version: 0.3.7 -->

为 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 提供 Token 用量、供应商余额与套餐额度统计，包含日历、费用估算、导出，以及模型选择器旁的额度展示。

本项目 Fork 自 [Ychris12138/dsh-usage-stats](https://github.com/Ychris12138/dsh-usage-stats)。本 Fork 的包内身份仍为 `@ychris12138/dsh-usage-stats`；上游 npm 包和市场条目不包含本 Fork 的修改。

## 兼容性

已验证：DSH 0.2.2-rc.1（源码与自动化检查）；尚未完成 Desktop 实测。

## 安装

在 DSH 的 **插件 → 添加 → Git 仓库** 输入：

```text
https://github.com/iBobbyTS/dsh-usage-stats.git
```

选择实际使用的 profile：Desktop 为 `desktop`，CLI web 通常为 `web`。只保留一份安装，避免与旧手工 Cordis 注册重复。安装后重启对应 DSH Host；Desktop 需完全退出后重新打开，只刷新窗口不会加载新的服务端代码。

如需验证指定提交，使用该提交构建的本地 `.tgz`，步骤见[开发与分发](docs/development.md)。

## 使用

- 打开侧边栏的 **用量/余额**，选择供应商、月份与日期查看统计。
- 在 **设置 → 模型** 的供应商卡片配置余额/额度监测；模型选择器旁显示当前会话路由的额度。
- Token 统计读取宿主用量事件；余额和额度是否可用取决于相应供应商接口或 Host 服务。费用是估算，缺失数据不会补成零。
- 不要在问题报告中附上密钥、Cookie、原始会话或未脱敏余额。

## 文档

- [供应商、监测配置与刷新](docs/configuration.md)
- [使用、导出、API 与兼容边界](docs/usage-and-api.md)
- [继承历史计量](docs/pr153-accounting-review.md) · [跟随主会话](docs/follow-current-session.md)
- [Host 额度协议](docs/quota-service-contract.md) · [OpenCode 用量来源](docs/opencode-usage-sources.md)
- [开发与分发](docs/development.md) · [开发规范](https://github.com/iBobbyTS/dsh-usage-stats/blob/main/AGENTS.md) · [安全策略](SECURITY.md)

Fork 问题请提交到 [iBobbyTS/dsh-usage-stats](https://github.com/iBobbyTS/dsh-usage-stats/issues)。[MIT](LICENSE)。
