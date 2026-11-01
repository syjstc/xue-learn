# Mac 安装与发布

普通用户请先阅读[好会学使用指南](user-guide.md)。下面的构建与发布操作面向维护者。

## 安装与首次使用

从 [Releases](https://github.com/syjstc/xue-learn/releases) 下载适合本机架构的 DMG，打开后将「好会学」拖入「应用程序」。`arm64` 为 Apple 芯片，`x64` 为 Intel。当前验收平台为 Apple 芯片 Mac，其他平台需要单独验证。

1. 打开「好会学」，在「连接学习助手」选择服务商或通用 OpenAI 兼容服务。DeepSeek 为推荐项，也可选择其他服务商或本机服务。
2. 输入自己的 API Key，点击「读取可用模型」，选择模型后保存。未提供列表或读取失败时，可从服务商控制台复制模型 ID 手动填写。读取列表不发起内容生成。
3. 按提示准备本机知识检索。可从 ModelScope 或 Hugging Face 下载推荐模型；已有配置无需重复下载。
4. 创建学习目标并开始学习。语音、图片和联网搜索可在设置中按需配置。可选搜索失败或超时会说明并继续后续流程。

API Key 在本机加密保存。更换通用服务地址的主机时，需要为新地址输入密钥。模型调用可能按量收费，详见[数据与隐私](privacy.md)。

## 一键打包与发布

先安装 Node.js 24 LTS（见 `.nvmrc`）、pnpm 9.15.9 和 [GitHub CLI](https://cli.github.com/)，通过 `gh auth login` 登录具有仓库推送和 Actions 读取权限的账号。在仓库根目录复制并填写本机签名配置：

```sh
cp .env.packaging.example .env.packaging
# 配置自己的 Developer ID 签名身份及 Apple 公证凭据
```

`.env.packaging` 被 Git 忽略。签名使用 `MACOS_SIGN_IDENTITY`；公证支持 `APPLE_NOTARY_KEYCHAIN_PROFILE`、App Store Connect API 私钥路径与 ID/Issuer，或 Apple ID/专用密码/团队。私钥应保存在源码目录之外。

准备新版本时，同步修改根目录、`desktop/`、`desktop/apps/desktop/` 三份 `package.json` 的版本，使用正式 `major.minor.patch`，并编写 `docs/releases/v<version>.md`。确认改动并提交；上传或发布需在默认分支的干净提交上执行。脚本不会自动改版本或提交工作区里的文件。

| 操作 | 在仓库根目录执行 |
| --- | --- |
| 只读预检，查看目标仓库、提交和计划 | `pnpm run release:mac --dry-run` |
| 完整检查并构建本机安装包 | `pnpm run release:mac --build-only` |
| 完整检查、打包并上传发布草稿（默认） | `pnpm run release:mac` |
| 将刚检查过的同一份安装包上传草稿 | `pnpm run release:mac --resume` |
| 检查通过后正式发布同一份安装包 | `pnpm run release:mac --resume --publish` |
| 从源码重新完整打包并直接正式发布 | `pnpm run release:mac --publish` |

`--build-only` 不访问 GitHub、不推送代码或标签。其他模式会在本地检查全部通过后，把当前提交推送到 `origin` 的默认分支，再推送精确版本标签。若仓库已经公开，推送源码会立即对外可见；发布草稿仍仅供有权限的维护者查看。脚本始终保留仓库原有可见性。

脚本依次执行：

1. 核对 Node/pnpm、三处版本、发布说明、干净源码、目标仓库和已存在的标签/发行。
2. 冻结锁文件安装依赖，执行 `check` 中的源码检查、测试、类型检查与构建，再执行完整 Git 历史和当前源码密钥扫描、依赖安全审计。未安装 Gitleaks 时，自动下载官方 8.30.1 对应 Mac 架构的归档，校验代码中固定的 SHA-256 后才解压执行；也可以通过 `GITLEAKS_PATH` 指定已有 8.30.1+ 可执行文件。
3. 构建并签名应用，完成 Apple 公证及票据装订，再制作、签名、公证并装订 DMG。
4. 核对应用与 DMG 的签名、公证、Gatekeeper、Electron 安全配置及源码指纹；只读挂载实际 DMG，核对包内应用的签名、版本、源码指纹与“应用程序”安装链接，并检查所需运行资源。
5. 除 `--build-only` 外，推送源码与精确标签，创建或续用相同源码的草稿，只上传 DMG，核对 GitHub 返回的文件大小、上传状态与 SHA-256。
6. 仅在显式给出 `--publish` 时，等待当前提交的 `Source and security` 云端 CI 成功，再次核对源码、远端标签、可见性和附件后，把草稿设为正式发行。

任何必需检查失败都会停止后续步骤，不会跳过失败检查或强行覆盖标签。安装包排除学习数据库、API Key、签名凭据、调试映射及本地输出，并保留项目与依赖许可。

最终 DMG 位于 `.release/mac/HaoHuiXue-<version>-mac-<arch>.dmg`。SHA-256、发布清单、公证收据和 `.release/mac/github-release.json` 上传回执保留在本机；对外手动附件只有 DMG。GitHub 自动提供的源码下载链接由平台生成。

### 中断后继续

```sh
pnpm run release:mac --resume                # 继续到草稿
pnpm run release:mac --resume --publish      # 继续并正式发布
pnpm run release:mac --resume --build-only   # 仅继续本机打包
```

`--resume` 复用同一提交的已有应用和公证进度，仍然执行测试与安全检查。源码有变化、安装包不匹配或标签指向其他提交时会停止；不会把旧包当作新包。Apple 进度保存在 `.release/notary/`。普通错误会自动释放发布锁；若进程被强制结束，先确认没有发布进程在运行，再清理 `.release/mac-release.lock` 后重试。

已上传且校验值一致的 DMG 会直接复用。不同校验值的同名附件、额外附件、其他提交的标签或已正式发布的版本都会停止并提示维护者处理，脚本不会删除附件或重写发行。源码变动后应准备新版本。

需要单独调试构建步骤时，仍可使用 `pnpm run build:mac`；公证中断后可用 `node scripts/build-mac-release.mjs --finish-existing`。这两个底层命令不包含整套测试和 GitHub 发布。

## 发布检查

在干净用户配置下打开实际 DMG，确认拖入安装、首次启动、模型配置、学习界面、退出与重启。对版本升级另行验证已有学习工作区和迁移。源码测试通过不代表所有设备或升级路径均已验收。

默认的一键命令停在草稿。确认实际安装和使用结果后，再执行 `pnpm run release:mac --resume --publish` 发布同一源码和安装包。

参考：[Electron 安全指南](https://www.electronjs.org/docs/latest/tutorial/security)、[Electron Forge Mac 签名](https://www.electronforge.io/guides/code-signing/code-signing-macos)、[GitHub 草稿与正式发行](https://cli.github.com/manual/gh_release_create)、[GitHub 附件校验信息](https://docs.github.com/en/rest/releases/assets)。
