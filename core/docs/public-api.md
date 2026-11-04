# Core 公共包接口

`@xue-learn/core` 使用 `package.json` 的 `exports` 声明公共能力。调用方通过能力名称导入，无需知道 `sources`、`src`、`libs` 等实现目录，也无需写 `.ts` 或 `.tsx`。包按固定版本安装和测试；源文件属于发布包，构建不读取相邻 Desktop、Video 或 Platform 仓库。

```ts
import type {RuntimeDescriptor} from "@xue-learn/core/runtime-contracts";
import {configureClientRuntime} from "@xue-learn/core/client-runtime";
import {Button} from "@xue-learn/core/ui/button";
import {createDisplayRegistry, DisplaySurface} from "@xue-learn/core/display/extensions";
```

## 选择入口

| 入口 | 使用场景 | 发布格式 |
| --- | --- | --- |
| 包根、`/browser` | 领域规则、教学格式和浏览器安全算法 | ESM JavaScript + 声明 |
| `/node` | 共享学习服务和 Nest 模块；数据库、进程生命周期由宿主提供 | ESM JavaScript + 声明 |
| `/workspace-client` | Electron main、Node 或独立工作区连接 SDK | ESM JavaScript + 声明；验证 CommonJS 宿主打包 |
| `/display` | 现有课程、音乐、公式等教学组件 | 浏览器 ESM + 声明；宿主打包器处理 CSS 与字体 |
| `/display/extensions` | 与课程模型无关的显示插件 registry 和 React surface | ESM JavaScript + 声明；仅依赖 React |
| `/display/runtime` | 统一文档、时钟、版本锁定、资源准备、隔离渲染和 placeholder | 浏览器 ESM + 声明 |
| `/display/catalog`、`/display/sampling` | 模型可读领域声明、旧内容适配、纯动画采样 | 无 DOM 的 ESM + 声明 |
| `/display/plugins` | 按领域动态加载共享动画组件 | 浏览器 ESM + 动态 chunks + 声明 |
| `/display/workspace` | 插件管理、工作区 provider、异步构建投影 | 浏览器 ESM + 声明 |
| `/display/film` | 共享电影式组件的兼容出口 | 浏览器 ESM + 声明；新宿主优先使用 runtime |
| `/display/runtime.css`、`/display/plugins.css`、`/display/workspace.css` | 统一 runtime 和领域组件样式 | CSS |
| `/display.css` | 现有教学组件的 Core 样式 | CSS |
| 下表能力入口 | 宿主按需组合领域模块、服务、共享 renderer 和组件 | TypeScript/TSX 源码 + 独立声明 |

Desktop 和 Video 的新入口使用 `/display/runtime` 和 `/display/workspace`，采用相同文档与动画组件。领域插件、跨域组合、用户导入与异步推导参见[统一展示插件文档](display-plugins/README.md)。旧 `/display/extensions` 和 `/display` 保留公共 API 兼容；其旧接入方式参见[显示扩展文档](display-extensions.md)。

## 能力子路径

| 公共路径 | 职责 |
| --- | --- |
| `/domain`、`/domain/<module>` | 领域类型、课程规则和持久化 port |
| `/contracts`、`/runtime-contracts` | 服务契约、运行时描述、跨宿主 DTO |
| `/common`、`/common/<module>` | 无宿主绑定的通用工具 |
| `/server`、`/server/<module>` | 共享学习服务；根入口导出与 `/node` 对应的源模块 |
| `/server/display-workspace`、`/server/display-plugins`、`/server/display-build` | 本地插件存储、模型发现和持久化异步组件构建 |
| `/formula-analysis` | 公式分析 |
| `/formal-derivation`、`/teaching-derivation` | 形式推导与教学推导 |
| `/formal-expression-core`、`/formal-expression-motion`、`/formal-expression-motion/styles.css` | 形式表达、动画描述与样式 |
| `/lab-engine`、`/lab-protocol` | 实验引擎与协议 |
| `/memory` | 学习记忆规则 |
| `/i18n` | 语言 provider、hooks、消息与格式化 |
| `/client-runtime` | renderer 的运行时配置和能力查询 |
| `/schemas`、`/api`、`/api/types`、`/api/sq-preview` | 共享输入 schema 与生成的 API 类型 |
| `/utils`、`/dev`、`/features` | UI 工具、开发功能和功能开关 |
| `/ui/button`、`/ui/dialog`、`/ui/sheet` | 共享 UI 基础组件 |
| `/shared/domain/<module>` | material-anchor、material-highlight、graph、compare-block、course-card-build、unit-lab |
| `/shared/design-tokens`、`/shared/dom/text-range-rect` | 设计 token 与 DOM 工具 |
| `/shared/music/audio-ownership`、`/shared/music/clip-player` | 音频所有权和播放工具 |
| `/shared/runtime/local-preferences`、`/shared/types/content-sources` | 本地偏好和内容来源类型 |
| `/display/<component>` | course-board-content、course-board-media、course-callout、guided-image-display、music-teaching-display、teaching-display、teaching-visual |
| `/display/templates/discipline-scenes` | 内置学科教学场景 |
| `/display/teaching.css`、`/display/templates.css` | 对应教学组件样式 |
| `/components/markdown/<component>` | code-block-shell、math-latex、prose-markdown |
| `/components/desktop-python-editor/<module>` | python-editor-provider、python-runtime；浏览器 Worker 由宿主打包 |
| `/components/goals/desktop-document-preview` | 文档预览组件 |
| `/components/wizard/graph-block`、`/components/wizard/interactive-material/material-visual-frame` | 图结构与交互素材组件 |
| `/features/teaching-derivation/board` | 教学推导面板 |
| `/fixtures/music-integration/topic.json` | 音乐集成验证使用的固定样例 |

领域与服务库支持模块子路径，例如 `/domain/persistence/course-source-port`、`/server/agenda/queries`。目录 `index` 入口使用简短名称，例如 `/server/assessment`、`/server/observability`、`/server/providers/audio`、`/server/teaching-skills`。renderer 子路径逐项声明，未声明的组件与共享模块不自动成为公共 API。包内测试文件不属于支持的 API。

## 宿主提供模型

`/server/providers/llm` 的 `createHostLlmProvider` 将宿主的模型流适配为 Core 学习服务使用的模型。`registerHostLlmProvider((selection, env) => provider)` 安装可撤销的进程内路由；返回 `undefined` 的选择继续使用内置服务商。宿主路由先于内置凭据检查和缓存，宿主切换模型后立即生效；销毁宿主时调用注册返回的 disposer。多个宿主共用进程时应按 `selection` 或当前用户上下文明确限定路由范围。

```ts
import {createHostLlmProvider, registerHostLlmProvider} from "@xue-learn/core/server/providers/llm";

const provider = createHostLlmProvider({
  id: "custom",
  stream: request => host.stream(request),
  getEmbeddings: () => host.embeddings,
});
const dispose = registerHostLlmProvider(() => provider);
// 宿主停止时：dispose();
```

请求携带 `system` / `user` / `assistant` / `tool` 消息、输出长度、停止序列和取消信号。工具轮次的 assistant 消息保留 `toolCalls: [{id, name, args}]`，工具结果保留 `toolCallId`。`bindTools` 将 Core 的工具 schema 转为 `tools: [{name, description?, parameters}]`，并把选择约束归一化为 `toolChoice: "auto" | "required" | "none" | {name}`。宿主流逐块返回文本字符串，或完整工具调用 `{type: "tool-call", id, name, args}`；Core 将它们还原为 LangChain 工具调用及关联历史，课程规划、阅读生成和追问继续使用原来的工具执行与校验逻辑。宿主应保留工具选择、取消及错误语义；非文本输入会明确报错。

结构化生成复用 Core 的 prompt JSON 解析、schema 校验和修复流程，不声明原生严格 schema 保证。使用 `id: "custom"` 表示宿主管理传输，而实际模型与调用记录由宿主保存。Embedding 由宿主另行提供，不会自动使用聊天模型或复制宿主凭据。

## 源入口与状态身份

能力入口保留源码，由宿主现有 TypeScript/SWC/Vite/esbuild 配置编译。这样 Nest 装饰器 metadata 仍按宿主规则生成，语言 provider、客户端 runtime 和组件内部 import 也指向同一份源模块。把每个能力独立 bundle 会产生独立状态副本，导致配置 runtime 后另一个组件仍读取默认值，或 provider 和 hook 使用不同的 React context。

浏览器预编译入口共享构建 chunks，领域模块保持动态加载。`i18n` 用稳定 symbol 共享 React Context 身份，允许宿主源入口的 provider 覆盖预编译领域组件；语言值仍属于每个 provider。其他有状态能力仍应使用同一入口组合。插件 registry 由宿主显式创建与传入，没有全局注册表。

源码入口需要打包器。TypeScript 推荐 `moduleResolution: "bundler"`；`NodeNext` 也支持 `exports` 的 `types` 条件。兼容既有 `moduleResolution: "node"` 的宿主由 `typesVersions` 提供声明路径。类型解析兼容不等同于 Node 可以直接执行带装饰器或 TSX 的源文件；直接执行的 Node 集成使用 `/node` 或 `/workspace-client`。

```json
{
  "compilerOptions": {
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx"
  }
}
```

调用方无需新增指向相邻仓库的 `paths`、alias 或 `file:` 依赖。发布包必须包含 `sources`、`types`、`dist` 和资源；使用固定发布制品安装后执行调用方的正式构建。

## 从内部路径迁移

| 旧导入 | 公共导入 |
| --- | --- |
| `@xue-learn/core/source/libs/runtime-contracts/src/index.ts` | `@xue-learn/core/runtime-contracts` |
| `@xue-learn/core/source/libs/domain/src/material-visual.ts` | `@xue-learn/core/domain/material-visual` |
| `@xue-learn/core/source/libs/server/src/agenda/queries.ts` | `@xue-learn/core/server/agenda/queries` |
| `@xue-learn/core/source/src/shared/i18n/index.tsx` | `@xue-learn/core/i18n` |
| `@xue-learn/core/source/src/shared/runtime/client-runtime.ts` | `@xue-learn/core/client-runtime` |
| `@xue-learn/core/source/src/lib/utils.ts` | `@xue-learn/core/utils` |
| `@xue-learn/core/source/src/components/ui/button.tsx` | `@xue-learn/core/ui/button` |
| `@xue-learn/core/source/src/components/course-display/teaching-display.tsx` | `@xue-learn/core/display/teaching-display` |

现有 `/source/*`、`/renderer/*` 与带 `.ts` 的库模块路径保留兼容，新增代码使用上表公共名称。历史导出记录、归档和旧版本构建元数据保留当时版本路径；迁移面向正在编译的调用方代码与检查脚本。

## 验证要求

```sh
pnpm install --frozen-lockfile
pnpm test
pnpm run check:boundaries
pnpm build
pnpm pack
```

`build` 从 Core 自己的源码生成公共 JavaScript 入口、领域 chunks、声明与包含文档的完整性清单，并自动执行两类包接口验证：

1. `check:exports` 检查所有显式 export 和支持的库模块的源码/声明目标存在，并用真实包解析测试每个入口的 Bundler 与 legacy Node 模式。所有 renderer 公共源入口一起审计，拒绝服务端模块、Node builtin、数据库、Electron 和私有视频依赖。
2. `verify-entries` 实际导入无需样式 loader 的 JavaScript 入口，编译浏览器展示入口及 CSS/字体资源，并将 workspace SDK 打包成 CommonJS 后加载。`display/extensions` 的构建图额外限制只能依赖其协议模块和 React。

声明 emit、路径验证、单元测试和调用方构建分别证明不同性质。每个消费包应执行自己的正式测试及构建，通过独立安装的固定版本制品验证该包使用的真实入口；Core 通过不能代替 Desktop、Platform、Video 或其他包的验证。新增能力需要同时添加 `exports`、声明和 `typesVersions`，并更新本页。正式发布前必须记录各包检查结果及尚未解决的失败。
