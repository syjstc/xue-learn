# Desktop 公共 Core API 验证

验证日期：2026-10-09。Desktop 使用已安装的 `@xue-learn/core@0.2.1` 固定发布制品。业务代码导入 `/runtime-contracts`、`/server/...`、`/i18n`、`/ui/...` 等公共能力名称；原 Core 源目录路径已迁移。

## 执行结果

| 检查 | 结果 | 证据 |
| --- | --- | --- |
| `pnpm run check:core` | 通过 | 发布制品、安装包 metadata、manifest 和 2856 个安装文件 SHA-256 一致；检查 798 个调用方源文件及 198 个公共 Core 导入 |
| `pnpm test` | 通过 | 90/90 test suites、288/288 tests |
| `pnpm run build:lab` | 通过 | 生成 `dist/lab-runtime` 浏览器实验运行时 |
| `pnpm run build:desktop-renderer` | 通过 | 生成 `dist-desktop` 正式 renderer |
| `pnpm run local-runtime:build:prod` | 通过 | 生成本地服务以及 SQLite persistence reference、migrations |
| `pnpm --dir apps/desktop run build:release` | 通过 | 生成 Electron main、preload 和 CloudKit bridge preload 的 release JavaScript |

`check:core` 确认 Core 从 Desktop 的 `node_modules` 加载，版本与 `core-dependency.v1.json` 的固定发布制品一致，并拒绝相邻 Core checkout、旧 `/source` 或 `/renderer` 公共路径、带代码扩展名的公共导入和无法解析的 export。现有内部源码兼容 resolver 仍服务于宿主编译配置；调用方业务导入使用正式 package exports。

## 测试解析修复与环境恢复

迁移暴露了 Jest 29 的 package exports 匹配问题：`./server/*.ts` 被其底层 resolver 以未转义的点匹配，公共路径 `/server/providers/llm/defaults` 因此错误地指向不存在的 `defau.ts`。Desktop 的 `scripts/jest-resolver.cjs` 现在使用 `createRequire(package.json).resolve()` 解析已安装 Core 的公共 exports，保留工作区 SDK 源测试和 renderer `dev` mock。正式构建原本已能正确解析该路径，修复后两个相关测试 suite 通过。

依赖重新安装时跳过 install scripts，导致 Desktop 测试缺少 `better-sqlite3` 原生 binding。验证使用同版本 `12.11.1`、同 Node `26.8.1`、ABI `147`、arm64 的已验证 Node binding 恢复本地 `node_modules`，并在 Desktop 执行内存数据库 `SELECT 1` smoke。此项是本地安装环境恢复，没有修改 Core 发布制品或应用源码。

工作区服务测试需要实际 Unix/loopback 通信。沙箱初跑出现监听 `EPERM`；解除这一测试环境限制后重新运行完整测试，90 suites、288 tests 全部通过。

## 验证范围与日志

本次全部指定检查通过，没有未解决的测试或构建失败。Vite 输出大 chunk 提示；这是构建体积警告，后续可单独优化加载策略。本次验证覆盖单元测试与正式编译流程；未执行 Forge 安装包制作、安装器验证或打包后的 GUI 启动验证。

本地完整日志：

- `/private/tmp/xue-learn-desktop-check-core.log`
- `/private/tmp/xue-learn-desktop-test.log`
- `/private/tmp/xue-learn-desktop-build-lab.log`
- `/private/tmp/xue-learn-desktop-build-renderer.log`
- `/private/tmp/xue-learn-desktop-build-runtime.log`
- `/private/tmp/xue-learn-desktop-build-host.log`

Core 的公共接口、TypeScript 源入口编译要求和模块状态身份规则见安装包的 `docs/public-api.md`；通用显示插件协议见其 `docs/display-extensions.md`。

## 同日补充：Desktop 开发启动

实际执行 `pnpm dev` 后补齐了三个启动问题：

- `.npmrc` 显式声明已有的 `hoist-pattern[]=*`，通过 Forge 的 pnpm 配置检查。
- 补齐 Forge 配置引用的 `load-packaging-env.ts` 和 `packager-ignore.ts`。打包过滤只允许包配置、编译后的三个宿主入口及其父目录，排除签名配置、本地学习数据、源码和调试文件。
- Vite 为 Core 显示源码使用的 Markdown、代码高亮等 CommonJS 依赖及深层入口显式预打包，解决 renderer 白屏时的 `does not provide an export named 'default'` 错误。

补充验证：`check:core` 通过，检查 2856 个安装文件、800 个调用方源文件和 198 个公共导入；完整测试 90/90 suites、290/290 tests 通过，包含两个宿主打包边界测试；`pnpm build` 通过。实际 Electron 窗口已显示现有课程页面，本地服务已连接数据库，开发 renderer 返回 HTTP 200。界面验证没有新建、编辑或删除学习内容。

补充日志在 `/private/tmp/xue-learn-desktop-2026-10-09-test.log` 和 `/private/tmp/xue-learn-desktop-2026-10-09-build.log`。本次验证覆盖开发模式的实际 GUI 启动，仍未制作或验证面向其他机器分发的安装包。
