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
pnpm run build:mac
```

构建使用 Node.js 24 LTS（见根目录 `.nvmrc`），避免非 LTS 版本的 Forge 兼容性问题。

安装包、SHA-256 和签名状态清单在 `.release/mac/`，文件名为 `HaoHuiXue-<version>-mac-<arch>.dmg`。`arm64` 对应 Apple 芯片，`x64` 对应 Intel；当前机器只验证其本机架构，不能把另一架构标为已验收。

收集脚本会核验打包资源、记录版本、架构、哈希、Developer ID 签名和公证状态。安装包不包含学习数据、API Key、私有 Video/Game/Platform 产品或额外下载的知识检索模型。

内部包如果没有 Developer ID 签名和公证，macOS 可能阻止打开，不应作为面向新用户的正式宣传下载版本。正式发布前配置 Forge 已支持的 `MACOS_SIGN_IDENTITY`、`APPLE_ID`、`APPLE_APP_SPECIFIC_PASSWORD`、`APPLE_TEAM_ID`，完成签名、公证及另一台 Mac 的安装验收。凭据通过环境变量或被忽略的 `.env.packaging` 提供。

## GitHub 预览下载

在私有仓库创建预发布，例如 `v0.3.0-preview.1`，上传 `.dmg`、`SHA256SUMS` 和 `release-manifest.json`。只有有权限的 GitHub 用户可以访问私有预览。

```sh
gh release create v0.3.0-preview.1 .release/mac/* \
  --repo syjstc/xue-learn --prerelease \
  --title '好会学 Desktop 0.3.0 · Mac 内部预览' \
  --notes-file docs/releases/v0.3.0-preview.1.md
```

仓库改为公开、正式发行和对外宣传应在内部验收后单独进行。

参考：[DeepSeek 官方 API 入门](https://api-docs.deepseek.com/)、[Electron Forge Mac 签名与公证](https://www.electronforge.io/guides/code-signing/code-signing-macos)。
