# Desktop 开源分发与 Core 更新

Desktop 是独立的 Electron 应用仓库。Core 是版本化的代码依赖；Desktop 安装包包含使用到的 Core 能力和本地服务，不要求用户部署 Core 服务器。

## 别人如何使用

| 使用方式 | 用户需要做什么 |
| --- | --- |
| 安装正式应用 | 下载适合操作系统和 CPU 架构的 Desktop 安装包；无需单独安装 Core、Node.js 或 pnpm |
| 从源码运行 | 克隆完整 Desktop 仓库，安装 Node.js 和 pnpm 9.15.9，安装依赖并执行 `pnpm dev` |
| 修改学习引擎 | 另外获取 Core 源码，生成新版本制品，再让 Desktop 显式升级这个版本 |

从源码运行，在 Desktop 仓库根目录执行：

```sh
pnpm install --frozen-lockfile
pnpm run check:core
pnpm dev
```

启动脚本会启动 renderer、lab runtime、本地服务和 Electron。依赖安装不能跳过所需原生模块的安装脚本。AI 生成功能仍需要用户在应用中配置自己的模型服务。

仓库的 `.npmrc` 显式声明 `hoist-pattern[]=*`，与 pnpm 默认的私有依赖提升策略一致，满足 Forge 的系统检查。Forge 的打包配置显式准备运行时依赖，不依赖它的默认依赖扫描。若启动停在 `Checking package manager version` 并提示 `node-linker`，先确认完整克隆了 `.npmrc`，在仓库内执行 `pnpm config get hoist-pattern` 应返回 `*`；无需修改用户的全局 pnpm 配置。

公开源码时，必须一起提交：

- `core-dependency.v1.json` 指向的 `vendor/*.tgz` 制品；
- 引用该制品的 `package.json` 文件，包括工作区子包；
- `pnpm-lock.yaml` 和 `core-dependency.v1.json`；
- Desktop 的源码、构建脚本、所需资源及许可文件。

本机已有 `node_modules` 不能代替这些发布文件。应在干净的克隆目录验证安装和启动，确认不依赖相邻 Core 仓库。

## 维护者如何升级 Core

升级顺序是：Core 生成新版本 → Desktop 选择这个版本 → 验证 Desktop → 发布新版 Desktop → 用户更新应用。

### 1. 生成新 Core 制品

在 Core 的 `package.json` 中设置新版本号，例如从 `0.2.1` 升到 `0.2.2`，然后在 Core 仓库根目录执行：

```sh
pnpm install --frozen-lockfile
pnpm test
pnpm pack --pack-destination release
```

Core 的 `prepack` 会执行正式构建及公共入口验证，并生成完整性清单。上例产生 `release/xue-learn-core-0.2.2.tgz`。有代码、资源或发布内容变化时使用新版本号；同一个已固定版本的制品不能替换成不同内容。

这一步可以仅生成 `.tgz`，无需先发布到 npm。Core 源码仓库用于阅读、修改和协作；Desktop 构建使用固定制品。

### 2. 让 Desktop 升级依赖

在 Desktop 仓库根目录执行，替换示例中的制品绝对路径：

```sh
pnpm run core:pin -- /path/to/xue-learn-core/release/xue-learn-core-0.2.2.tgz
pnpm install --no-frozen-lockfile
pnpm run check:core
pnpm test
pnpm build
```

`core:pin` 会读取制品的版本与完整性清单，将它复制到 `vendor/`，并更新引用 Core 的包配置和 SHA-256 收据。随后安装依赖会更新锁文件。普通 `pnpm update` 不会替这个固定的本地制品选择新 Core 版本。

`check:core` 检查制品及安装内容一致、Core 安装在 Desktop 的 `node_modules` 内、公共导入合法。Desktop 自己的测试和正式构建仍需通过；Core 的测试不能代替它们。若公共接口变化，在本次升级中同步修改 Desktop 的调用代码。

将新制品、所有变更的包配置、锁文件、收据和必要的调用代码一起提交。源码使用者拉取该提交后运行 `pnpm install --frozen-lockfile`、`pnpm run check:core` 和 `pnpm dev`。

### 3. 发布新的 Desktop 安装包

设置 Desktop 应用的新版本号；Forge 安装包使用 `apps/desktop/package.json` 中的版本。完成上述构建后执行：

```sh
pnpm --dir apps/desktop run make
```

安装包输出到 `apps/desktop/out/`。为需要支持的系统和架构分别制作安装包，完成适用的签名、公证及另一台机器上的安装、启动和核心功能验证，再公开分发。已有的 [Core API 验证记录](../core-api-verification.md) 覆盖源码测试和正式编译，尚未覆盖安装包制作与打包后 GUI 启动。

普通用户更新 Desktop 安装包即可获得新版 Core；Core 仓库的提交或新 `.tgz` 不会自动改变已经安装的 Desktop。若数据结构变化，随 Desktop 发版提供相应迁移并验证现有学习数据。

## 许可范围

自有代码采用 MIT。品牌素材、其他媒体和第三方依赖遵循各自条款，见仓库的 [许可范围](../../LICENSING.md)。
