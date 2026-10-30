# Mac 内部预览与发布

当前仓库 `syjstc/xue-learn` 为私有仓库。先在内部验收快速配置和安装体验，再准备对外发布。

## 第一次使用

1. 打开「好会学」，在「连接学习助手」的下拉菜单选择服务商。支持 DeepSeek、MiniMax、Qwen、OpenAI、Doubao、GLM、Fireworks、Ollama、Codex，以及通用 OpenAI 兼容地址。DeepSeek 仅标为推荐项，不预先选择。
2. 填写对应 API Key（Ollama 和 Codex 走各自本机/账号方式），点击「读取可用模型」，选择服务商刚返回的模型后保存。模型名称不使用内置固定列表。服务未提供列表、权限不足或网络出错时会说明原因，并允许从其控制台复制模型 ID 手动填写。读取模型列表不发起付费内容生成；保存后可在高级设置检测实际对话能力。
3. 在「准备知识检索」下载推荐的本机模型，完成后进入学习引导。国内网络默认使用 ModelScope，也可选择 Hugging Face。已有检索配置的用户无需重复下载。
4. 创建一个学习目标，开始学习。语音、图片、联网搜索可在「设备设置 → 快速开始」按需开启，各自需要相应的服务配置。学习目标初始搜索未启用、失败或超过 8 秒会跳过并继续问询，不反复重试；时效性信息不会被标为已核实。

已配置学习助手的用户会保留原有选择。读取模型列表不会保存新密钥或切换当前模型，只有点击保存才激活所选配置。密钥在本机加密保存，不写入源码或安装包。更换通用服务地址的主机时，需要为新地址显式输入密钥。

## 制作本机架构的 Mac 包

```sh
pnpm install --frozen-lockfile
pnpm run check
cp .env.packaging.example .env.packaging
# 填写已有签名身份和 Apple 公证配置后运行：
pnpm run build:mac
```

构建使用 Node.js 24 LTS（见根目录 `.nvmrc`），避免非 LTS 版本的 Forge 兼容性问题。

安装包、SHA-256 和签名状态清单在 `.release/mac/`，文件名为 `HaoHuiXue-<version>-mac-<arch>.dmg`。`arm64` 对应 Apple 芯片，`x64` 对应 Intel；当前机器只验证其本机架构，不能把另一架构标为已验收。

构建流程会签名应用、提交 Apple 公证、装订应用票据，再生成并签名 DMG、完成 DMG 公证和票据装订。导出前核验应用和 DMG 的签名、公证票据以及 Gatekeeper 结果；任一项失败都会停止，不导出新下载包。安装包不包含学习数据、API Key、私有 Video/Game/Platform 产品或额外下载的知识检索模型。

签名和公证都是下载包的必需条件，私有预览也执行相同检查。通过被忽略的 `.env.packaging` 或环境变量提供已有配置：签名身份为 `MACOS_SIGN_IDENTITY`；公证支持现有钥匙串配置 `APPLE_NOTARY_KEYCHAIN_PROFILE`、App Store Connect API 密钥文件路径及 ID/Issuer，或 Apple ID/专用密码/团队。示例见根目录 `.env.packaging.example`。私钥保留在本机原有位置，凭据不进入源码或安装包。

Apple 的提交 ID 与进度保存在 `.release/notary/`。等待超时后，可用 Node 24 执行 `node scripts/build-mac-release.mjs --finish-existing` 继续现有产物的公证；相同归档会复用提交 ID。Apple 拒绝时会保留公证日志供排查。

## GitHub 预览下载

发布页只上传对应版本和架构的 DMG。`SHA256SUMS`、`release-manifest.json`、`notarization.json` 保留在本地用于发布核验，不作为下载附件。私有阶段需要有权限的 GitHub 用户访问，公开后直接使用同一下载入口。

```sh
gh release create v0.3.0-preview.1 .release/mac/HaoHuiXue-0.3.0-mac-arm64.dmg \
  --repo syjstc/xue-learn --prerelease \
  --title '好会学 Desktop 0.3.0 · macOS' \
  --notes-file docs/releases/v0.3.0-preview.1.md
```

仓库改为公开、正式发行和对外宣传应在内部验收后单独进行。

参考：[DeepSeek 官方 API 入门](https://api-docs.deepseek.com/)、[Electron Forge Mac 签名与公证](https://www.electronforge.io/guides/code-signing/code-signing-macos)。
