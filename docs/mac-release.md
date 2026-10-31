# Mac 安装与发布

## 安装与首次使用

从 [Releases](https://github.com/syjstc/xue-learn/releases) 下载适合本机架构的 DMG，打开后将「好会学」拖入「应用程序」。`arm64` 为 Apple 芯片，`x64` 为 Intel。当前验收平台为 Apple 芯片 Mac，其他平台需要单独验证。

1. 打开「好会学」，在「连接学习助手」选择服务商或通用 OpenAI 兼容服务。DeepSeek 为推荐项，也可选择其他服务商或本机服务。
2. 输入自己的 API Key，点击「读取可用模型」，选择模型后保存。未提供列表或读取失败时，可从服务商控制台复制模型 ID 手动填写。读取列表不发起内容生成。
3. 按提示准备本机知识检索。可从 ModelScope 或 Hugging Face 下载推荐模型；已有配置无需重复下载。
4. 创建学习目标并开始学习。语音、图片和联网搜索可在设置中按需配置。可选搜索失败或超时会说明并继续后续流程。

API Key 在本机加密保存。更换通用服务地址的主机时，需要为新地址输入密钥。模型调用可能按量收费，详见[数据与隐私](privacy.md)。

## 构建正式安装包

使用 Node.js 24 LTS 和 pnpm 9.15.9，在仓库根目录执行：

```sh
pnpm install --frozen-lockfile
pnpm run check
pnpm run check:security
cp .env.packaging.example .env.packaging
# 配置自己的 Developer ID 签名身份及 Apple 公证凭据
pnpm run build:mac
```

`.env.packaging` 被 Git 忽略。签名使用 `MACOS_SIGN_IDENTITY`；公证支持 `APPLE_NOTARY_KEYCHAIN_PROFILE`、App Store Connect API 私钥路径与 ID/Issuer，或 Apple ID/专用密码/团队。私钥应保存在源码目录之外。

构建流程签名应用，完成 Apple 公证及票据装订，再制作、签名、公证并装订 DMG。导出前检查应用与 DMG 的签名、公证票据、Gatekeeper 结果和实际版本；任何必需检查失败都会停止。安装包排除学习数据库、API Key、签名凭据、调试映射及本地输出，并保留项目与依赖许可。

最终 DMG 位于 `.release/mac/HaoHuiXue-<version>-mac-<arch>.dmg`。本地校验文件包括 SHA-256、发布清单与公证收据；对外附件只提供 DMG。Apple 提交进度位于 `.release/notary/`。超时后使用 `node scripts/build-mac-release.mjs --finish-existing` 继续同一产物的公证。

## 发布检查

在干净用户配置下打开实际 DMG，确认拖入安装、首次启动、模型配置、学习界面、退出与重启。对版本升级另行验证已有学习工作区和迁移。源码测试通过不代表所有设备或升级路径均已验收。

仓库提交、GitHub 可见性和正式发行分别操作。准备供检查的下载时创建草稿，确认源码提交和产物一致后再由维护者发布：

```sh
gh release create v0.3.1 .release/mac/HaoHuiXue-0.3.1-mac-arm64.dmg \
  --repo syjstc/xue-learn --draft --target main \
  --title '好会学 0.3.1' --notes-file docs/releases/v0.3.1.md
```

参考：[Electron 安全指南](https://www.electronjs.org/docs/latest/tutorial/security)、[Electron Forge Mac 签名](https://www.electronforge.io/guides/code-signing/code-signing-macos)。
