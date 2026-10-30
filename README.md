# 好会学 · XueLearn Desktop 与 Core

好会学是一款个人学习桌面应用：从一个想学的问题出发，规划学习路径，通过阅读、交互演示、追问与练习逐步理解。

当前仓库为私有仓库，用于完善 Mac 安装和首次使用体验。Core 与 Desktop 的历史和源码在这里一起维护；Video Studio、Game、Platform 保持独立。

## Mac 快速开始

安装包包含应用和本地服务，使用者不需要安装 Node.js 或 pnpm。打开应用后，从下拉菜单选择模型服务商或通用 OpenAI 兼容服务，填写 API Key，再从服务商实时返回的列表选择模型。DeepSeek 作为推荐选项；未提供模型列表的服务可手动填写模型 ID。随后按提示准备本机知识检索。语音、图片和联网搜索可按需配置，搜索不可用时会告知并跳过。模型 API 可能按用量计费，应用不附带 API 额度。

[内部预览下载](https://github.com/syjstc/xue-learn/releases) · [首次使用与 Mac 发布说明](docs/mac-preview.md)

预览包的架构、哈希、签名和公证状态见随包的 `release-manifest.json`。当前仓库的私有下载需要 GitHub 访问权限。

Core and Desktop share one pnpm workspace and one lockfile. Desktop uses `workspace:*` to resolve the Core source in this repository. Every Desktop check, test, development start and full build rebuilds Core first, so a Desktop change uses the current Core without a separate version bump or archive pin.

## Develop

Use Node.js 24 LTS (see `.nvmrc`) and pnpm `9.15.9` from the repository root:

```sh
pnpm run setup
pnpm run check
pnpm run dev
```

`pnpm run check` builds and tests Core, verifies Desktop's workspace link, then tests Desktop and builds its renderer and local service. It does not package the application. For a smaller loop, use `pnpm run test:core`, `pnpm run test:desktop`, or the individual build scripts.

After changing Core, run the normal workspace checks:

```sh
pnpm run check
```

Desktop resolves the current `core/` directory. `pnpm run dev` also rebuilds Core when its source changes. Core's package version changes when publishing a release for other consumers, not for each Desktop edit. Private Video, Game and Platform products continue to consume explicit Core releases; installed Desktop applications receive Core changes through a new Desktop release.

See [Core](core/README.md) and [Desktop](desktop/README.md) for component setup and architecture. The [license scope](LICENSING.md) explains the MIT code grant and separate brand/media terms.
