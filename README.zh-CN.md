# 好会学 · XueLearn

[English](README.md) · [简体中文](README.zh-CN.md)

好会学是一款 AI 个人学习桌面应用。告诉它你想学什么、现在会多少，它会帮你规划学习路径，带你按小节阅读讲解、看演示、提问和练习。下次打开时，可以继续学习并复习学过的内容。

<p align="center">
  <img src="docs/images/learning-flow-hero.png" alt="学习流程：设定目标 → 学习路径 → 选中追问 → 练习巩固。Goal / Path / Ask / Practice" width="960">
</p>

例如：“我没有统计学基础，想看懂新闻里的平均数、概率和相关性，请多用生活中的例子。”你也可以带着自己的教材、笔记或公开网页开始学习。

**[下载 Mac 版](https://github.com/syjstc/xue-learn/releases) · [使用指南：从安装到第一课](docs/user-guide.md) · [常见问题](docs/user-guide.md#常见问题)**

- **学习路径**：把学习目标拆成模块、小节与可验证的能力。
- **阅读与追问**：按小节阅读，选中文本提问，保留追问的位置与上下文。
- **交互演示**：在学习内容中查看动画、图解、公式与交互组件。
- **练习与复习**：通过测验与复习记录积累学习证据。
- **本机工作区**：学习记录保存在本机，可自行选择模型服务商并管理扩展。

本仓库包含 [Core 学习库](core/)、[Desktop 桌面应用](desktop/)和 [DSH 插件](apps/dsh-plugin/)，使用同一 pnpm workspace 和锁文件。两个应用始终构建和使用仓库中的当前 Core。DSH 插件在 DeepSeek Harness 内运行，使用宿主默认文本模型，安装步骤见[插件说明](apps/dsh-plugin/README.md)。

## 安装与开始学习

[前往 Releases 下载 Mac 安装包](https://github.com/syjstc/xue-learn/releases) · [普通用户使用指南](docs/user-guide.md)

macOS 当前提供 Apple 芯片版本。打开 DMG，将「好会学」拖入「应用程序」。安装包包含应用和本地服务，无需另行安装 Node.js、pnpm 或 Core。正式 Mac 安装包执行 Developer ID 签名、Apple 公证和 Gatekeeper 检查。

0.3.4 安装包包含简体中文、繁體中文和 English 界面，默认跟随系统，不支持的语言回退为英文。首次配置页和“设置中心 → 外观”均可切换并保存选择；课程内容的语言单独设置，切换界面不会改写已有课程。

首次启动时选择模型服务商，填写自己的 API Key，并读取可用模型列表。DeepSeek 为推荐选项，也支持其他服务商、通用 OpenAI 兼容服务和本机 Ollama。未提供模型列表的服务可手动填写模型 ID。随后按提示准备本机知识检索，创建学习目标即可开始。语音、图片和联网搜索可按需配置。

模型服务可能按用量计费，应用不附带 API Key 或 API 额度。使用外部模型服务时，相关提问、学习内容或选取的文档会发送给你配置的服务商；详情见[数据与隐私](docs/privacy.md)。

## 从源码开发

安装 Node.js 24 LTS（见 `.nvmrc`）和 pnpm `9.15.9`，在仓库根目录执行：

```sh
pnpm run setup
pnpm run check
pnpm run dev
```

`check` 检查源码边界、翻译词条与参数，构建和测试 Core、Desktop 与 DSH 插件，执行类型检查，并构建渲染器和本地服务。开发启动会监听 Core 源码变化并重建，无需单独同步版本。安装依赖时需允许原生模块的构建脚本。

```sh
pnpm run check:i18n
pnpm run test:core
pnpm run test:desktop
pnpm run pack:dsh       # 构建、测试并生成 .release/dsh 中的插件包
pnpm run check:security  # 需要 Gitleaks 8.30.1+ 及联网的 npm advisory registry
pnpm run build:mac      # 在 macOS 使用自己的签名与公证配置
pnpm run release:mac    # 检查、正式打包并上传发布草稿
```

安装包不会随源码提交自动更新；用户通过安装新版本获得更新。Windows、Linux 和 Intel Mac 的构建配置尚需对应设备验证。

维护者的一键打包、草稿与正式发布命令见 [Mac 发布说明](docs/mac-release.md#一键打包与发布)。

参见 [Core API](core/docs/public-api.md)、[Desktop 插件](desktop/docs/desktop-plugins.md)、[贡献指南](CONTRIBUTING.md)和[安全策略](SECURITY.md)。

## 许可

自有源码采用 [MIT](LICENSE)。品牌名称、图标与部分媒体另有条款；第三方依赖保留原始许可。请阅读[许可范围](LICENSING.md)、[Core 第三方说明](core/THIRD_PARTY_NOTICES.md)和 [Desktop 第三方说明](desktop/THIRD_PARTY_NOTICES.md)。
