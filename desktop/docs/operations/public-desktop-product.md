# Desktop 开源分发与 Core 更新

Core 和 Desktop 位于同一个公开 Git 仓库，使用根目录的 `pnpm-workspace.yaml` 和 `pnpm-lock.yaml`。Desktop 与 Lab 对 Core 声明 `workspace:*`，安装后链接到当前仓库的 `core/` 源码。应用安装包包含构建时使用的 Core 能力和本地服务；用户无需单独安装 Core、Node.js 或 pnpm。

## 从源码开发

在公开仓库根目录安装 Node.js、pnpm `9.15.9`，然后执行：

```sh
pnpm install --frozen-lockfile
pnpm run check
pnpm run dev
```

`check` 构建并测试 Core，核验 Desktop 的工作区链接和公共导入，再测试 Desktop、构建渲染器与本地服务。`dev` 启动 Desktop 前构建当前 Core，并在 Core 源码变化时自动重建。依赖安装需允许所需原生模块的安装脚本；AI 生成功能仍由用户在应用里配置模型服务。

仓库根目录的 `.npmrc` 保留 `hoist-pattern[]=*`，满足 Forge 的依赖布局检查。Forge 的打包配置显式准备运行时依赖，不依赖默认依赖扫描。若启动停在 `Checking package manager version`，先确认根目录 `.npmrc` 已克隆，`pnpm config get hoist-pattern` 应返回 `*`。

## Core 与 Desktop 一起迭代

修改 `core/` 后直接运行 `pnpm run check` 或 `pnpm run dev`。Desktop 的检查、测试、开发启动和正式构建都会先构建当前 Core；两边的源码与根锁文件放在同一次提交中，无需为 Desktop 单独打包 Core、更新版本号或维护 `vendor/*.tgz` 收据。`check:core` 还会拒绝解析到本仓库以外的 Core，并校验当前构建的完整性清单及公共导入。

Core 的包版本号仍用于向独立消费者发布版本；私有 Video、Game、Platform 产品继续固定各自认可的 Core 制品，不直接读取这个公开仓库的源码。已经安装的 Desktop 应用不会因源码提交自行变化，需发布新的安装包。

## 构建安装包

在公开仓库根目录执行：

```sh
pnpm run check
pnpm --dir desktop/apps/desktop run make
```

`make` 会先构建当前 Core 与完整 Desktop，再在 `desktop/apps/desktop/out/` 生成当前平台的安装包。签名、公证、其他架构上的安装与实际图形界面验证属于后续发布步骤；源码构建成功不等于安装包已经验收。数据结构变化还需随 Desktop 发版提供迁移并验证现有学习数据。

## 许可范围

自有代码采用 MIT。品牌素材、其他媒体和第三方依赖遵循各自条款，见仓库根目录的 [许可范围](../../../LICENSING.md)。
