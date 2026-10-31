# 好会学 · XueLearn

好会学是一款个人学习桌面应用。从一个想学的问题出发，规划学习路径，通过阅读、交互演示、追问与练习逐步理解。

- **学习路径**：把学习目标拆成模块、小节与可验证的能力。
- **阅读与追问**：按小节阅读，选中文本提问，保留追问的位置与上下文。
- **交互演示**：在学习内容中查看动画、图解、公式与交互组件。
- **练习与复习**：通过测验与复习记录积累学习证据。
- **本机工作区**：学习记录保存在本机，可自行选择模型服务商并管理扩展。

本仓库包含 [Core 学习库](core/) 和 [Desktop 桌面应用](desktop/)，使用同一 pnpm workspace 和锁文件。Desktop 始终构建和使用仓库中的当前 Core。

## 安装与开始学习

[前往 Releases 下载 Mac 安装包](https://github.com/syjstc/xue-learn/releases) · [安装与首次配置](docs/mac-release.md)

macOS 当前提供 Apple 芯片版本。打开 DMG，将「好会学」拖入「应用程序」。安装包包含应用和本地服务，无需另行安装 Node.js、pnpm 或 Core。正式 Mac 安装包执行 Developer ID 签名、Apple 公证和 Gatekeeper 检查。

首次启动时选择模型服务商，填写自己的 API Key，并读取可用模型列表。DeepSeek 为推荐选项，也支持其他服务商、通用 OpenAI 兼容服务和本机 Ollama。未提供模型列表的服务可手动填写模型 ID。随后按提示准备本机知识检索，创建学习目标即可开始。语音、图片和联网搜索可按需配置。

模型服务可能按用量计费，应用不附带 API Key 或 API 额度。使用外部模型服务时，相关提问、学习内容或选取的文档会发送给你配置的服务商；详情见[数据与隐私](docs/privacy.md)。

## 从源码开发

安装 Node.js 24 LTS（见 `.nvmrc`）和 pnpm `9.15.9`，在仓库根目录执行：

```sh
pnpm run setup
pnpm run check
pnpm run dev
```

`check` 检查源码边界，构建和测试 Core、Desktop，执行类型检查，并构建渲染器和本地服务。开发启动会监听 Core 源码变化并重建，无需单独同步版本。安装依赖时需允许原生模块的构建脚本。

```sh
pnpm run test:core
pnpm run test:desktop
pnpm run check:security  # 需要 Gitleaks 8.30.1+ 及联网的 npm advisory registry
pnpm run build:mac      # 在 macOS 使用自己的签名与公证配置
```

安装包不会随源码提交自动更新；用户通过安装新版本获得更新。Windows、Linux 和 Intel Mac 的构建配置尚需对应设备验证。

参见 [Core API](core/docs/public-api.md)、[Desktop 插件](desktop/docs/desktop-plugins.md)、[贡献指南](CONTRIBUTING.md)和[安全策略](SECURITY.md)。

## 许可

自有源码采用 [MIT](LICENSE)。品牌名称、图标与部分媒体另有条款；第三方依赖保留原始许可。请阅读[许可范围](LICENSING.md)、[Core 第三方说明](core/THIRD_PARTY_NOTICES.md)和 [Desktop 第三方说明](desktop/THIRD_PARTY_NOTICES.md)。
