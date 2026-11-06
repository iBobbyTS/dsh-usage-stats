# Development and distribution

## 开发与验证 / Development

```bash
pnpm install --frozen-lockfile
pnpm check
pnpm test
npm pack --json
```

`pnpm test` 完全离线，覆盖 bundle、客户端渲染与请求竞态、服务端安全边界、余额/Token Plan adapter、缓存和安装器幂等性。真实数据验证需先运行 `dsh web`：

```bash
pnpm validate:live
node scripts/check-balance.mjs
```

所有服务端脚本均遵循 `DSH_HOME`。`check-balance.mjs` 可能显示真实余额，不要把输出粘贴到公开 issue。


## Fork distribution

This fork is installed from `https://github.com/iBobbyTS/dsh-usage-stats.git` or from a local tarball built from the intended commit. The internal package name remains `@ychris12138/dsh-usage-stats`; the upstream npm package and Community Market source do not deliver this fork. Do not infer registry publication from the version in `package.json`.

For a local candidate, run `npm pack --json` and install the resulting `.tgz` in the intended DSH profile. Restart that profile's Host; a browser refresh alone cannot reload Host code. Report installed-runtime acceptance separately from source tests.

`pnpm check:release` checks package identity, entrypoints, lockfile and README version consistency. `pnpm release:sync <version>` updates version fields and the README marker; it does not publish or create a fork registry/market distribution.

## Inherited upstream release material

This fork has no Pages deployment or market catalog. The [release checklist](release-checklist.md) and versioned release plans/notes describe the inherited upstream npm/market release process. They are historical/reference material, not instructions to install or publish this fork. A fork release channel would need its own explicit distribution decision before publishing. Historical account acceptance does not establish current installed-runtime acceptance.

## Credits

Forked from [Ychris12138/dsh-usage-stats](https://github.com/Ychris12138/dsh-usage-stats). The original provider research and contributor references remain in the versioned release documents and [provider accounting review](pr153-accounting-review.md).
- [Javis603/token-monitor](https://github.com/Javis603/token-monitor)：参考多 provider 配额归一化与 Z.ai 限额解析。
- [xiaoqi20/dsh-opencode-go-usage](https://github.com/xiaoqi20/dsh-opencode-go-usage)：参考 DSH 凭据接入、OpenCode `auth.json` 回退与 Bearer usage endpoint。
- [Plocr/dsh-commandcode-goat](https://github.com/Plocr/dsh-commandcode-goat)：参考 Command Code 官方 CLI 的 `/alpha/*` 账户端点、档位命名与 credits 口径。
- [#121](https://github.com/Ychris12138/dsh-usage-stats/pull/121)（@hanxucn）：Command Code 适配器与三条窗口的归一化实现主要取自该 PR（作者已关闭未合并），本 PR 在其基础上按维护者 review 意见补上可配置客户端版本、README 契约说明，并修掉 provider 插件注册 route 不带 `apiKeyEnv` 导致的一律「未配置」。

本项目重新实现统一 account protocol、adapter 与单供应商 UI，不复制参考项目界面。

[MIT](../LICENSE).

## Source, build and distribution

Edit `src/*.ts`; `lib/` JS, source maps and quota declarations are generated and committed together. `view-protocol.ts` owns the shared public account/usage views; Host credentials, network adapters and file I/O stay outside the browser graph. Public module exports keep their existing paths.

Use Node 24.11.0 and the pinned pnpm version. Run `pnpm install --frozen-lockfile`, `pnpm typecheck`, and `pnpm build:runtime`. `pnpm test` prepares and tests an isolated candidate; `pnpm check:dist` independently rebuilds, compares the entire generated file set, packs the candidate and verifies clean tarball/Git installation. `pnpm check` reuses one candidate build for behavior and distribution checks. Installation runs no plugin compiler hook.

The package version is owned by package.json. Release synchronization updates that file and the README marker; pnpm's root importer has no package version field. Release checks compare the lockfile's actual dependency specifiers with package.json. Cross-plugin quota/autosave tests take an explicit ChatGPT candidate directory; autosave compilation uses this project's declared esbuild dependency. Providers Hub integration continues to require its explicit external candidate. Default tests remain offline and single-repository.
