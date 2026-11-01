import { countVariant, useT } from "../../shared/i18n/index.js";
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
  const t = useT();
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
        {t("display.ui.exportDefinition")}
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
                ? t(
                    "display.ui.disabledForNewCoursesExistingCoursesCanStillPlay",
                  )
                : t("display.ui.enabledForNewCourses"),
            )
          }
        >
          {enabled ? t("display.ui.disable") : t("display.ui.enable")}
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
      plugins.map((record) => displayPluginInfo(record.manifest, t).domain),
    ),
  ];
  const shown = plugins.filter((record) => {
    const info = displayPluginInfo(record.manifest, t);
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
          displayComponentInfo(component, t).title,
          displayComponentInfo(component, t).summary,
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
    <section
      className="display-plugin-manager"
      aria-label={t("display.ui.displayPlugins")}
    >
      <header className="display-plugin-heading">
        <div>
          <span className="display-plugin-eyebrow">
            {t("display.ui.displayLibrary")}
          </span>
          <h1 ref={heading} tabIndex={-1}>
            {t("display.ui.displayPlugins")}
          </h1>
          <p>{t("display.ui.previewAComponentThenChooseHowToPresentYour")}</p>
        </div>
        <label
          className="display-plugin-import"
          htmlFor={inputId}
          aria-disabled={busy}
        >
          <span aria-hidden="true">＋</span> {t("display.ui.importPlugin")}
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
                  throw Error(
                    t("display.ui.pluginFilesMustBeNoLargerThan2Mib"),
                  );
                return client.post(
                  DISPLAY_PLUGINS_ENDPOINT + "/import",
                  JSON.parse(await file.text()),
                );
              }, t("display.ui.pluginInstalledAndReadyToPreviewEnabledComponentsAre"));
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
            onClick={() =>
              void change(refresh, t("display.ui.pluginListRefreshed"))
            }
          >
            {t("display.ui.refresh")}
          </button>
        </div>
      )}
      {notice && (
        <p className="display-plugin-message" role="status">
          {notice}
        </p>
      )}
      {busy && !plugins.length && (
        <p role="status">{t("display.ui.loadingPlugins")}</p>
      )}
      {selection && !busy && (!selectedRecord || !selectedComponent) ? (
        <div className="display-plugin-empty">
          <h2>{t("display.ui.displayComponentNotFound")}</h2>
          <p>
            {t("display.ui.thePluginOrComponentVersionMayHaveChangedChoose")}
          </p>
          <button type="button" onClick={() => select(null)}>
            {t("display.ui.backToLibrary")}
          </button>
        </div>
      ) : null}
      {selectedRecord && selectedComponent ? (
        <>
          <nav
            className="display-plugin-breadcrumb"
            aria-label={t("display.ui.previewPath")}
          >
            <button type="button" onClick={() => select(null)}>
              {t("display.ui.allPlugins")}
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
              {displayPluginInfo(selectedRecord.manifest, t).title}
            </button>
            <span aria-hidden="true">/</span>
            <span aria-current="page">
              {displayComponentInfo(selectedComponent, t).title}
            </span>
          </nav>
          <div className="display-plugin-detail">
            <aside className="display-plugin-sidebar">
              <h2>{t("display.ui.browseComponents")}</h2>
              <nav aria-label={t("display.ui.pluginAndComponentNavigation")}>
                {plugins.map((record) => {
                  const active =
                      key(record.manifest) === key(selectedRecord.manifest),
                    info = displayPluginInfo(record.manifest, t);
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
                              {displayComponentInfo(component, t).title}
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
                    {displayPluginInfo(selectedRecord.manifest, t).title} ·{" "}
                    {currentIndex + 1} /{" "}
                    {selectedRecord.manifest.components.length}
                  </span>
                  <h2>{displayComponentInfo(selectedComponent, t).title}</h2>
                  <p>{displayComponentInfo(selectedComponent, t).summary}</p>
                </div>
                <div className="display-plugin-step-buttons">
                  <button
                    type="button"
                    aria-label={t("display.ui.previousComponent")}
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
                    aria-label={t("display.ui.nextComponent")}
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
                  <h3>{t("display.ui.noExampleDataForThisComponent")}</h3>
                  <p>{t("display.ui.loadComponentInputDataToPreviewItHere")}</p>
                </div>
              )}
              <div className="display-plugin-example-bar">
                <div
                  className="display-plugin-example-tabs"
                  role="group"
                  aria-label={t("display.ui.previewExample")}
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
                  {customSample && <span>{t("display.ui.customExample")}</span>}
                </div>
                <label
                  className="display-plugin-sample-import"
                  htmlFor={sampleInputId}
                >
                  {t("display.ui.loadExampleData")}
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
                            throw Error(
                              t(
                                "display.ui.exampleFilesMustBeNoLargerThan2Mib",
                              ),
                            );
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
                {t("display.ui.dragTheProgressSliderToExploreTheAnimationOr")}
              </p>
              <details className="display-plugin-definition">
                <summary>{t("display.ui.pluginDetailsAndExampleData")}</summary>
                <p>
                  {selectedRecord.manifest.title} ·{" "}
                  {selectedRecord.manifest.version}
                </p>
                <p className="display-plugin-version">
                  {t("display.library.componentVersion", {
                    kind: selectedComponent.kind,
                    version: selectedComponent.version,
                  })}{" "}
                  ·{" "}
                  {selectedRecord.builtin
                    ? t("display.ui.builtIn")
                    : selectedRecord.enabled
                      ? t("display.ui.enabled")
                      : t("display.ui.disabledPreviewAvailable")}
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
                  placeholder={t("display.ui.searchPluginsComponentsOrUses")}
                  aria-label={t("display.ui.searchPluginsAndComponents")}
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                />
              </label>
              <span className="display-plugin-count">
                {t("display.library.counts", {
                  plugins: plugins.length,
                  components: plugins.reduce(
                    (count, record) =>
                      count + record.manifest.components.length,
                    0,
                  ),
                })}
              </span>
            </div>
            <nav
              className="display-plugin-categories"
              aria-label={t("display.ui.pluginCategories")}
            >
              <button
                type="button"
                aria-pressed={category === "all"}
                onClick={() => setCategory("all")}
              >
                {t("display.ui.all")}
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
                          displayPluginInfo(record.manifest, t).domain ===
                          domain,
                      )!.manifest,
                      t,
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
                  {t("display.ui.imported")}
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
                  {plugins.length
                    ? t("display.ui.noMatchingPlugins")
                    : t("display.ui.noDisplayPluginsYet")}
                </h2>
                <p>
                  {plugins.length
                    ? t("display.ui.tryAnotherSearchOrBrowseAllCategories")
                    : t(
                        "display.ui.importAPluginToBrowseAndPreviewItsComponents",
                      )}
                </p>
                {plugins.length > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      setQuery("");
                      setCategory("all");
                    }}
                  >
                    {t("display.ui.clearFilters")}
                  </button>
                )}
              </div>
            )}
            <p className="display-plugin-help">
              {t("display.ui.openACardToPreviewItsComponentsExportedPlugins")}
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
  const t = useT();
  const { manifest, builtin, enabled } = record,
    info = displayPluginInfo(manifest, t),
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
            <p>{t("display.ui.openAComponentToPreviewAnExample")}</p>
          </div>
        )}
        <button
          type="button"
          className="display-plugin-card-cover"
          aria-label={t("display.preview.component", { title: info.title })}
          disabled={!component}
          onClick={() => open(manifest, component)}
        >
          <span className="display-plugin-poster-link">
            {t("display.ui.previewComponent")}
            <span aria-hidden="true">↗</span>
          </span>
        </button>
      </div>
      <div className="display-plugin-card-body">
        <div className="display-plugin-card-heading">
          <h2>{info.title}</h2>
          <span className={!enabled ? "is-disabled" : ""}>
            {builtin
              ? t("display.ui.builtIn")
              : enabled
                ? t("display.ui.enabled")
                : t("display.ui.disabled")}
          </span>
        </div>
        <p className="display-plugin-card-summary">{info.summary}</p>
        <div className="display-plugin-components">
          {manifest.components.map((item) => (
            <button
              type="button"
              key={`${item.kind}@${item.version}`}
              title={displayComponentInfo(item, t).summary}
              onClick={() => open(manifest, item)}
            >
              {displayComponentInfo(item, t).title}
            </button>
          ))}
        </div>
        <footer>
          <span>
            {t(
              `display.library.componentCount.${countVariant(manifest.components.length)}`,
              { count: manifest.components.length },
            )}{" "}
            · v{manifest.version}
          </span>
          {actions}
        </footer>
      </div>
    </article>
  );
}
