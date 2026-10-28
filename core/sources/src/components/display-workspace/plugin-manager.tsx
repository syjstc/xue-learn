import React, { useEffect, useId, useMemo, useRef, useState } from "react";
import type {
  DisplayComponentManifest,
  DisplayPluginManifest,
} from "../../../libs/display/src/types.js";
import { useDisplayPreviewRuntime } from "./provider.js";
import { DisplayPluginPreview } from "./plugin-preview.js";
import {
  createDisplayPreviewDocument,
  displayComponentInfo,
  displayPluginInfo,
  displayPreviewExamples,
  displaySelection,
  type DisplayPluginSelection,
  type DisplayPreviewExample,
} from "./preview-catalog.js";
import "./workspace.css";

export type DisplayPluginRecord = Readonly<{
  manifest: DisplayPluginManifest;
  builtin: boolean;
  enabled: boolean;
  sha256: string;
}>;
export type DisplayWorkspaceClient = Readonly<{
  get<T>(path: string): Promise<T>;
  post<T>(path: string, value: unknown): Promise<T>;
}>;
export const DISPLAY_PLUGINS_ENDPOINT = "/api/local/display-plugins";
const key = (manifest: DisplayPluginManifest) =>
  `${manifest.id}@${manifest.version}`;
const preferred = (manifest: DisplayPluginManifest) =>
  manifest.components.find(
    (component) =>
      component.kind ===
      (
        {
          general: "general:cards",
          math: "math:teaching",
          physics: "physics:teaching",
          music: "music:score",
          computing: "computing:code",
          media: "media:image",
        } as Record<string, string>
      )[displayPluginInfo(manifest).domain],
  ) ?? manifest.components[0];

/** Router-neutral library shared by learning and video hosts. */
export function DisplayPluginManager({
  client,
  onChanged,
  selection: suppliedSelection,
  onSelectionChange,
}: {
  client: DisplayWorkspaceClient;
  onChanged?: () => void | Promise<void>;
  selection?: DisplayPluginSelection | null;
  onSelectionChange?: (selection: DisplayPluginSelection | null) => void;
}) {
  const inputId = useId(),
    sampleInputId = useId();
  const runtime = useDisplayPreviewRuntime();
  const [plugins, setPlugins] = useState<readonly DisplayPluginRecord[]>([]);
  const [busy, setBusy] = useState(true),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [localSelection, setLocalSelection] =
    useState<DisplayPluginSelection | null>(null);
  const [query, setQuery] = useState(""),
    [category, setCategory] = useState("all"),
    [variant, setVariant] = useState(0);
  const [customSample, setCustomSample] = useState<DisplayPreviewExample>(),
    [sampleError, setSampleError] = useState("");
  const heading = useRef<HTMLHeadingElement>(null),
    focusNext = useRef(false);
  const selection =
    suppliedSelection === undefined ? localSelection : suppliedSelection;
  const selectedRecord = plugins.find(
    (record) =>
      record.manifest.id === selection?.pluginId &&
      record.manifest.version === selection.pluginVersion,
  );
  const selectedComponent = selectedRecord?.manifest.components.find(
    (component) =>
      component.kind === selection?.kind &&
      component.version === selection.componentVersion,
  );
  const select = (next: DisplayPluginSelection | null) => {
    focusNext.current = true;
    if (onSelectionChange) onSelectionChange(next);
    else setLocalSelection(next);
  };
  const selectedKey = selection
    ? `${selection.pluginId}@${selection.pluginVersion}:${selection.kind}@${selection.componentVersion}`
    : "";
  useEffect(() => {
    setVariant(0);
    setCustomSample(undefined);
    setSampleError("");
    setNotice("");
    if (focusNext.current) {
      heading.current?.focus();
      heading.current?.scrollIntoView({ block: "start" });
      focusNext.current = false;
    }
  }, [selectedKey]);
  useEffect(() => {
    let active = true;
    setBusy(true);
    setError("");
    client
      .get<readonly DisplayPluginRecord[]>(DISPLAY_PLUGINS_ENDPOINT)
      .then((value) => {
        if (active) setPlugins(value);
      })
      .catch((failure) => {
        if (active) setError(String(failure?.message ?? failure));
      })
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => {
      active = false;
    };
  }, [client]);
  // Preview imports without changing the live course registry.
  useEffect(() => {
    const releases = plugins
      .filter(
        (record) =>
          !runtime.catalog.get(record.manifest.id, record.manifest.version),
      )
      .map((record) => runtime.catalog.register(record.manifest));
    return () => releases.forEach((release) => release());
  }, [plugins, runtime]);
  const refresh = async () =>
    setPlugins(
      await client.get<readonly DisplayPluginRecord[]>(
        DISPLAY_PLUGINS_ENDPOINT,
      ),
    );
  const change = async (work: () => Promise<unknown>, message: string) => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await work();
      await refresh();
      await onChanged?.();
      setNotice(message);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setBusy(false);
    }
  };
  const exportPlugin = (manifest: DisplayPluginManifest) => {
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(manifest, null, 2) + "\n"], {
        type: "application/json",
      }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `${manifest.id}-${manifest.version}.display.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const actions = ({ manifest, builtin, enabled }: DisplayPluginRecord) => (
    <div className="display-plugin-actions">
      <button type="button" onClick={() => exportPlugin(manifest)}>
        导出定义
      </button>
      {!builtin && (
        <button
          type="button"
          disabled={busy}
          onClick={() =>
            void change(
              () =>
                client.post(DISPLAY_PLUGINS_ENDPOINT + "/enabled", {
                  id: manifest.id,
                  version: manifest.version,
                  enabled: !enabled,
                }),
              enabled
                ? "已停止在新课程中使用。已有课程仍可播放。"
                : "已启用，可用于生成新课程。",
            )
          }
        >
          {enabled ? "停用" : "启用"}
        </button>
      )}
    </div>
  );
  const examples = useMemo(
    () =>
      selectedRecord && selectedComponent
        ? displayPreviewExamples(selectedRecord.manifest, selectedComponent)
        : [],
    [selectedRecord, selectedComponent],
  );
  const sample =
    customSample ?? examples[variant % Math.max(1, examples.length)];
  const previewDocument = useMemo(
    () =>
      selectedRecord && selectedComponent && sample
        ? createDisplayPreviewDocument(
            selectedRecord.manifest,
            selectedComponent,
            sample,
          )
        : undefined,
    [selectedRecord, selectedComponent, sample],
  );
  const categories = [
    ...new Set(
      plugins.map((record) => displayPluginInfo(record.manifest).domain),
    ),
  ];
  const shown = plugins.filter((record) => {
    const info = displayPluginInfo(record.manifest);
    return (
      (category === "all" ||
        (category === "imported" && !record.builtin) ||
        category === info.domain) &&
      [
        info.title,
        info.summary,
        record.manifest.title,
        record.manifest.id,
        ...record.manifest.components.flatMap((component) => [
          component.kind,
          displayComponentInfo(component).title,
          displayComponentInfo(component).summary,
        ]),
      ]
        .join(" ")
        .toLowerCase()
        .includes(query.trim().toLowerCase())
    );
  });
  const openComponent = (
    manifest: DisplayPluginManifest,
    component: DisplayComponentManifest,
  ) => select(displaySelection(manifest, component));
  const currentIndex =
    selectedRecord?.manifest.components.indexOf(selectedComponent!) ?? -1;
  return (
    <section className="display-plugin-manager" aria-label="Display 插件">
      <header className="display-plugin-heading">
        <div>
          <span className="display-plugin-eyebrow">展示组件库</span>
          <h1 ref={heading} tabIndex={-1}>
            Display 插件
          </h1>
          <p>先看效果，再选择适合课程的展示方式。学习与视频共用同一套组件。</p>
        </div>
        <label
          className="display-plugin-import"
          htmlFor={inputId}
          aria-disabled={busy}
        >
          <span aria-hidden="true">＋</span> 导入插件
          <input
            id={inputId}
            type="file"
            accept=".json,.display.json,application/json"
            disabled={busy}
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (!file) return;
              void change(async () => {
                if (file.size > 2 * 1024 * 1024)
                  throw Error("插件文件不能超过 2 MiB。");
                return client.post(
                  DISPLAY_PLUGINS_ENDPOINT + "/import",
                  JSON.parse(await file.text()),
                );
              }, "插件已安装，可以打开预览。新课程可使用已启用的组件。");
            }}
          />
        </label>
      </header>
      {error && (
        <div className="display-plugin-message" role="alert">
          <p>{error}</p>
          <button
            type="button"
            disabled={busy}
            onClick={() => void change(refresh, "插件列表已更新。")}
          >
            重新读取
          </button>
        </div>
      )}
      {notice && (
        <p className="display-plugin-message" role="status">
          {notice}
        </p>
      )}
      {busy && !plugins.length && <p role="status">正在加载插件…</p>}
      {selection && !busy && (!selectedRecord || !selectedComponent) ? (
        <div className="display-plugin-empty">
          <h2>找不到这个展示组件</h2>
          <p>插件或组件版本可能已改变，请返回插件库重新选择。</p>
          <button type="button" onClick={() => select(null)}>
            返回插件库
          </button>
        </div>
      ) : null}
      {selectedRecord && selectedComponent ? (
        <>
          <nav className="display-plugin-breadcrumb" aria-label="预览路径">
            <button type="button" onClick={() => select(null)}>
              ← 全部插件
            </button>
            <span aria-hidden="true">/</span>
            <button
              type="button"
              onClick={() =>
                openComponent(
                  selectedRecord.manifest,
                  preferred(selectedRecord.manifest),
                )
              }
            >
              {displayPluginInfo(selectedRecord.manifest).title}
            </button>
            <span aria-hidden="true">/</span>
            <span aria-current="page">
              {displayComponentInfo(selectedComponent).title}
            </span>
          </nav>
          <div className="display-plugin-detail">
            <aside className="display-plugin-sidebar">
              <h2>浏览组件</h2>
              <nav aria-label="插件与组件导航">
                {plugins.map((record) => {
                  const active =
                      key(record.manifest) === key(selectedRecord.manifest),
                    info = displayPluginInfo(record.manifest);
                  return (
                    <div
                      className="display-plugin-nav-group"
                      key={key(record.manifest)}
                    >
                      <button
                        type="button"
                        className={active ? "is-active" : ""}
                        aria-expanded={active}
                        onClick={() =>
                          openComponent(
                            record.manifest,
                            preferred(record.manifest),
                          )
                        }
                      >
                        <span aria-hidden="true">{info.symbol}</span>
                        {info.title}
                        <small aria-hidden="true">
                          {record.manifest.components.length}
                        </small>
                      </button>
                      {active && (
                        <div className="display-plugin-nav-components">
                          {record.manifest.components.map((component) => (
                            <button
                              type="button"
                              key={`${component.kind}@${component.version}`}
                              aria-current={
                                component === selectedComponent
                                  ? "page"
                                  : undefined
                              }
                              onClick={() =>
                                openComponent(record.manifest, component)
                              }
                            >
                              {displayComponentInfo(component).title}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </nav>
            </aside>
            <div className="display-plugin-detail-main">
              <div className="display-plugin-detail-heading">
                <div>
                  <span className="display-plugin-eyebrow">
                    {displayPluginInfo(selectedRecord.manifest).title} ·{" "}
                    {currentIndex + 1} /{" "}
                    {selectedRecord.manifest.components.length}
                  </span>
                  <h2>{displayComponentInfo(selectedComponent).title}</h2>
                  <p>{displayComponentInfo(selectedComponent).summary}</p>
                </div>
                <div className="display-plugin-step-buttons">
                  <button
                    type="button"
                    aria-label="上一个组件"
                    disabled={currentIndex <= 0}
                    onClick={() =>
                      openComponent(
                        selectedRecord.manifest,
                        selectedRecord.manifest.components[currentIndex - 1],
                      )
                    }
                  >
                    ←
                  </button>
                  <button
                    type="button"
                    aria-label="下一个组件"
                    disabled={
                      currentIndex >=
                      selectedRecord.manifest.components.length - 1
                    }
                    onClick={() =>
                      openComponent(
                        selectedRecord.manifest,
                        selectedRecord.manifest.components[currentIndex + 1],
                      )
                    }
                  >
                    →
                  </button>
                </div>
              </div>
              {previewDocument ? (
                <DisplayPluginPreview
                  key={
                    selectedKey + ":" + variant + ":" + Boolean(customSample)
                  }
                  document={previewDocument}
                  runtime={runtime}
                />
              ) : (
                <div className="display-plugin-empty">
                  <span aria-hidden="true">◇</span>
                  <h3>这个组件还没有示例数据</h3>
                  <p>加载一份组件输入数据，即可在这里查看实际效果。</p>
                </div>
              )}
              <div className="display-plugin-example-bar">
                <div
                  className="display-plugin-example-tabs"
                  role="group"
                  aria-label="预览示例"
                >
                  {examples.map((item, index) => (
                    <button
                      type="button"
                      key={index}
                      aria-pressed={!customSample && variant === index}
                      onClick={() => {
                        setCustomSample(undefined);
                        setSampleError("");
                        setVariant(index);
                      }}
                    >
                      {item.label}
                    </button>
                  ))}
                  {customSample && <span>自定义示例</span>}
                </div>
                <label
                  className="display-plugin-sample-import"
                  htmlFor={sampleInputId}
                >
                  加载示例数据
                  <input
                    id={sampleInputId}
                    type="file"
                    accept=".json,application/json"
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      event.target.value = "";
                      if (!file) return;
                      void (async () => {
                        try {
                          if (file.size > 2 * 1024 * 1024)
                            throw Error("示例文件不能超过 2 MiB。");
                          setCustomSample({
                            label: file.name,
                            payload: JSON.parse(await file.text()),
                          });
                          setSampleError("");
                        } catch (failure) {
                          setSampleError(
                            failure instanceof Error
                              ? failure.message
                              : String(failure),
                          );
                        }
                      })();
                    }}
                  />
                </label>
              </div>
              {sampleError && (
                <p role="alert" className="display-plugin-message">
                  {sampleError}
                </p>
              )}
              <p className="display-plugin-preview-note">
                拖动进度查看动画；交互乐谱可直接试听。这里的示例不会修改课程内容。
              </p>
              <details className="display-plugin-definition">
                <summary>插件信息与示例数据</summary>
                <p>
                  {selectedRecord.manifest.title} ·{" "}
                  {selectedRecord.manifest.version}
                </p>
                <p className="display-plugin-version">
                  {selectedComponent.kind} · 组件版本{" "}
                  {selectedComponent.version} ·{" "}
                  {selectedRecord.builtin
                    ? "内置"
                    : selectedRecord.enabled
                      ? "已启用"
                      : "已停用，仍可预览"}
                </p>
                {actions(selectedRecord)}
                {sample && <pre>{JSON.stringify(sample.payload, null, 2)}</pre>}
              </details>
            </div>
          </div>
        </>
      ) : (
        !selection && (
          <>
            <div className="display-plugin-toolbar">
              <label className="display-plugin-search">
                <span aria-hidden="true">⌕</span>
                <input
                  type="search"
                  placeholder="搜索插件、组件或用途…"
                  aria-label="搜索插件和组件"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                />
              </label>
              <span className="display-plugin-count">
                {plugins.length} 个插件 ·{" "}
                {plugins.reduce(
                  (count, record) => count + record.manifest.components.length,
                  0,
                )}{" "}
                个组件
              </span>
            </div>
            <nav className="display-plugin-categories" aria-label="插件分类">
              <button
                type="button"
                aria-pressed={category === "all"}
                onClick={() => setCategory("all")}
              >
                全部
              </button>
              {categories.map((domain) => (
                <button
                  type="button"
                  key={domain}
                  aria-pressed={category === domain}
                  onClick={() => setCategory(domain)}
                >
                  {
                    displayPluginInfo(
                      plugins.find(
                        (record) =>
                          displayPluginInfo(record.manifest).domain === domain,
                      )!.manifest,
                    ).title
                  }
                </button>
              ))}
              {plugins.some((record) => !record.builtin) && (
                <button
                  type="button"
                  aria-pressed={category === "imported"}
                  onClick={() => setCategory("imported")}
                >
                  已导入
                </button>
              )}
            </nav>
            <div className="display-plugin-grid">
              {shown.map((record) => (
                <PluginCard
                  key={key(record.manifest)}
                  record={record}
                  runtime={runtime}
                  open={openComponent}
                  actions={actions(record)}
                />
              ))}
            </div>
            {!busy && !shown.length && (
              <div className="display-plugin-empty">
                <h2>
                  {plugins.length ? "没有找到匹配的插件" : "还没有展示插件"}
                </h2>
                <p>
                  {plugins.length
                    ? "试试其他关键词，或查看全部分类。"
                    : "导入插件后，即可浏览组件和预览效果。"}
                </p>
                {plugins.length > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      setQuery("");
                      setCategory("all");
                    }}
                  >
                    清除筛选
                  </button>
                )}
              </div>
            )}
            <p className="display-plugin-help">
              点击卡片预览全部组件。导出的插件可以分享；已有课程保留其使用的版本。
            </p>
          </>
        )
      )}
    </section>
  );
}

function PluginCard({
  record,
  runtime,
  open,
  actions,
}: {
  record: DisplayPluginRecord;
  runtime: ReturnType<typeof useDisplayPreviewRuntime>;
  open: (
    manifest: DisplayPluginManifest,
    component: DisplayComponentManifest,
  ) => void;
  actions: React.ReactNode;
}) {
  const { manifest, builtin, enabled } = record,
    info = displayPluginInfo(manifest),
    component = preferred(manifest);
  const document = useMemo(() => {
    const sample = component && displayPreviewExamples(manifest, component)[0];
    return sample
      ? createDisplayPreviewDocument(manifest, component, sample)
      : undefined;
  }, [manifest, component]);
  return (
    <article className="display-plugin-card">
      <div className="display-plugin-card-entry">
        {document ? (
          <DisplayPluginPreview document={document} runtime={runtime} poster />
        ) : (
          <div className="display-plugin-poster display-plugin-poster-empty">
            <span aria-hidden="true">{info.symbol}</span>
            <p>打开组件，加载示例预览</p>
          </div>
        )}
        <button
          type="button"
          className="display-plugin-card-cover"
          aria-label={`预览${info.title}`}
          disabled={!component}
          onClick={() => open(manifest, component)}
        >
          <span className="display-plugin-poster-link">
            预览组件 <span aria-hidden="true">↗</span>
          </span>
        </button>
      </div>
      <div className="display-plugin-card-body">
        <div className="display-plugin-card-heading">
          <h2>{info.title}</h2>
          <span className={!enabled ? "is-disabled" : ""}>
            {builtin ? "内置" : enabled ? "已启用" : "已停用"}
          </span>
        </div>
        <p className="display-plugin-card-summary">{info.summary}</p>
        <div className="display-plugin-components">
          {manifest.components.map((item) => (
            <button
              type="button"
              key={`${item.kind}@${item.version}`}
              title={displayComponentInfo(item).summary}
              onClick={() => open(manifest, item)}
            >
              {displayComponentInfo(item).title}
            </button>
          ))}
        </div>
        <footer>
          <span>
            {manifest.components.length} 个组件 · v{manifest.version}
          </span>
          {actions}
        </footer>
      </div>
    </article>
  );
}
