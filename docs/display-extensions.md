# 可扩展 Display：宿主驱动的渲染插件

Display 接受宿主提供的内容和状态，然后选择一个组件展示。内容生成、网络请求、登录、持久化、播放时钟都由宿主负责。新增交互实验、实时图表或其他动态内容，不需要先修改 core 的课程 schema、LLM 能力描述或生成服务。

使用轻量入口：

```ts
import {
  createDisplayRegistry,
  DisplaySurface,
  type DisplayNode,
  type DisplayPlugin,
} from "@xue-learn/core/display/extensions";
```

这个入口的运行时只依赖 React，不引用 domain 或 server，不加载现有教学、音乐、公式展示组件。已有 `@xue-learn/core/display` 和 `TeachingDisplay` 等组件仍然可用；完整 display 入口也导出这里的 API。扩展机制是可信应用代码的组件注册表，不是远程代码沙箱或第三方插件商店。

## 数据边界

每个展示内容都有一个稳定的 envelope：

```ts
type DisplayNode<Payload = unknown> = Readonly<{
  id: string;
  kind: string;
  version: number;
  payload: Payload;
}>;
```

`kind` 建议使用命名空间，例如 `acme:live-chart`。`version` 是该 kind 的 payload schema 版本，必须为正整数；它不是 package 版本。`id` 是当前展示实例身份，同一个内容的实时更新保持相同 id。payload 的结构由插件定义，注册时必须提供验证函数。

选择依据是 `kind + version` 的精确匹配。一个 kind 的不同版本可以由不同插件负责。同一 id 重复注册或多个插件覆盖同一个 kind/version 会立即报错，因此选择结果不会受到注册顺序影响。未知 kind 或版本会进入宿主可定制的 fallback。

Registry 不负责将未知数据转换为课程材料，也不负责保存 payload。宿主从任意 API、文件或数据流得到 envelope 后将它传入即可。插件只接收通过自己验证函数的数据。

## 注册一个动态内容插件

下面的插件接收宿主已经加载的数据和宿主动作，不需要 core 的内容生成能力。需要接入外部流时，宿主可以用自己的 query/store 或订阅机制更新 context。

```tsx
import React, {useMemo, useState} from "react";
import {
  createDisplayRegistry,
  DisplaySurface,
  type DisplayNode,
  type DisplayPlugin,
} from "@xue-learn/core/display/extensions";

type CounterPayload = {title: string};
type HostContext = {
  currentValue: number;
  increment: () => void;
};

const liveCounter: DisplayPlugin<CounterPayload, HostContext> = {
  id: "acme.live-counter",
  kind: "acme:live-counter",
  versions: [1],
  validate: (value): value is CounterPayload =>
    typeof value === "object" && value !== null &&
    typeof (value as CounterPayload).title === "string",
  Component: ({node, context}) => (
    <section aria-label={node.payload.title}>
      <p>{node.payload.title}: {context.currentValue}</p>
      <button onClick={context.increment}>增加</button>
    </section>
  ),
};

const counterNode: DisplayNode<CounterPayload> = {
  id: "counter-1",
  kind: "acme:live-counter",
  version: 1,
  payload: {title: "当前计数"},
};

export function CounterHost() {
  // 每个宿主拥有自己的 registry，不共享全局注册状态。
  const registry = useMemo(() => {
    const result = createDisplayRegistry<HostContext>();
    result.register(liveCounter);
    return result;
  }, []);
  const [currentValue, setValue] = useState(0);
  const context = useMemo(() => ({
    currentValue,
    increment: () => setValue(value => value + 1),
  }), [currentValue]);

  return <DisplaySurface
    registry={registry}
    node={counterNode}
    context={context}
    fallback={() => <p>此内容暂时无法展示。</p>}
  />;
}
```

新增内容只需定义 envelope、验证器、组件并注册。显示交互结果不需要让 core 生成或认识 `acme:live-counter`。扩展包可以只依赖轻量 display 入口和 React；宿主负责组合扩展包和其他服务。

## 装载、卸载与 React 生命周期

`register(plugin)` 返回幂等的注销函数。运行时注册和注销会通知已经挂载的 `DisplaySurface`。适合按路由、工作区或功能包装载扩展；在宿主自己的 effect 中注册时，需要返回注销函数：

```tsx
useEffect(() => registry.register(liveCounter), [registry]);
```

宿主需要按需装载代码时，直接使用 `React.lazy`，并明确决定模块来源：

```tsx
const lazyCounter: DisplayPlugin<CounterPayload, HostContext> = {
  ...liveCounter,
  Component: React.lazy(() => import("./counter-view.js")),
};
registry.register(lazyCounter);

// DisplaySurface 自带 Suspense，loadingFallback 由宿主提供。
<DisplaySurface registry={registry} node={counterNode} context={context}
  loadingFallback={<p>正在加载内容…</p>}/>;
```

`counter-view.js` 的 default export 必须是接收 `DisplayPluginProps<CounterPayload, HostContext>` 的 React 组件。Registry 自身不下载代码。组件可以消费宿主注入的订阅服务；如果在组件中订阅，必须在 `useEffect` cleanup 中退订并取消请求。

- payload 和 context 的更新保留组件本地状态；使用新的对象传递更新，避免原地修改已传入的数据。
- `id`、`kind`、`version` 或当前插件注册身份变化时，该展示实例重新挂载，React 执行原实例 cleanup。
- 注销当前插件后进入 fallback，原组件卸载。即使在同一批次注销再注册相同组件，也会重新挂载。
- 注册其他不相关插件不会重新挂载当前组件。
- 每个 registry 相互独立，适合多个窗口、不同工作区和并行测试。不要在模块全局创建所有宿主共用的 registry。
- 已挂载的 surface 切换到另一 registry 时，原插件组件卸载，即使两个 registry 注册了同一个组件。

## 失败、验证和隔离范围

`fallback(failure)` 接收 `reason`、原 node、可用时的 `pluginId` 和 error。reason 有 `invalid-node`、`unsupported`、`invalid-payload`、`validation-error`、`render-error`。`onFailure` 可以将这些信息送到宿主自己的日志或提示系统；用户界面应由 fallback 提供友好的文案。

验证器抛错会进入 fallback。浏览器内的组件 render/lifecycle 错误由每个 surface 的错误边界隔离；更新 node 或 context、注册信息改变后会重试。失败的展示不会替换宿主导航或其他 display 实例。该边界不捕获事件处理器和异步任务中的异常；插件必须自行处理这些异常、取消和卸载后的回调。

React 服务端渲染不执行 effect，React 错误边界也不能捕获 SSR renderer 异常。SSR 宿主需要自己的请求级错误处理。插件是和宿主处于同一 JavaScript 权限范围内的可信代码；对于不可信脚本，应在宿主另行使用 iframe/worker 隔离及消息协议，不能仅靠组件错误边界。

## 接入现有课程展示

现有教学材料可以由宿主适配成 DisplayNode。适配器负责验证原材料并将其交给已有组件；核心 registry 不需要导入完整课程 domain。例如宿主已有 `TeachingDisplay` 时，可以注册一个调用它的组件，并显式传入宿主时钟和其他 props。这允许现有教学内容和新的实时内容使用同一宿主路由，同时让纯动态内容扩展保持轻量。

这一版没有自动把全部课程组件迁移为插件，也没有改动课程持久化格式。需要把新 kind 写入课程存储时，宿主或存储协议应显式保存 envelope，并定义 schema 升级与编辑行为；只有显示机制支持未知 kind，并不代表既有材料解析器自动接受新字段。

## 验证

`display-registry.spec.ts` 覆盖精确版本选择、元数据/路由冲突、payload 验证与验证异常、订阅通知、幂等注销、配置快照和宿主隔离。`display-surface.spec.tsx` 使用实际 React DOM 挂载，覆盖实时 payload/context 更新、组件状态保留、身份变化 cleanup、热注册/卸载、未知内容 fallback、渲染错误恢复以及宿主提供的 lazy loader。

```sh
pnpm test -- sources/src/components/course-display/display-registry.spec.ts sources/src/components/course-display/display-surface.spec.tsx
```
