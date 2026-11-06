# 开发规范

维护 DSH 的用量计量、供应商账户展示与脱敏额度集成。认证、账户选择和上游授权归相应 Host/provider；不通过抓取其他插件凭据、推测余额或修改模型路由来补齐数据。

- 以宿主实际事件和精确 Session 继承边界计量；复制历史不重复计数，独立调用不误合并。计量合同归[计量边界](docs/pr153-accounting-review.md)，保留有效的不可读源汇总。
- 凭据只在 Host 侧解析；浏览器、导出、缓存和错误只包含各自合同允许的投影。安全边界归[SECURITY](SECURITY.md)，跨插件协议归[额度协议](docs/quota-service-contract.md)。
- 使用 DSH 公开扩展接口，将 UI、异步结果和配置写入关联到实际 Session/provider；缺失数据不伪装为成功、零余额或完整费用。
- README 是人用入口，配置和 API 细节归 `docs/`；历史发布记录不重新定义当前行为。同步受影响的源码、消费者和文档，并按[开发说明](docs/development.md)验证，保留无关工作。
- 本 Fork 的安装和支持来源是 `iBobbyTS/dsh-usage-stats`；包名保持现状，上游 npm/市场发布不代表本 Fork 已发布。发布与部署遵循用户授权。真实账户验证通过任务已授权的 Host/provider 路径，不直接读取、提交或输出真实凭据。

开发、构建与交付遵循 [父目录统一规范](../docs/plugin-development.md)。`src/` 是唯一运行逻辑编辑源，`lib/` 由显式构建生成并与源码一起交付；quota 公共声明也从同源 TS 生成。
