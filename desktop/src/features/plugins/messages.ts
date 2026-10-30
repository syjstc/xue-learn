const en = {
  title: "Desktop plugins",
  manage: "Manage desktop plugins",
  description:
    "Add video production, tools and other capabilities to your learning workspace.",
  install: "Install local plugin",
  installHint:
    "Choose a plugin package folder. New plugins are installed disabled so you can review them before enabling.",
  refresh: "Refresh",
  loading: "Loading plugins…",
  working: "Working…",
  emptyTitle: "No desktop plugins installed",
  emptyDescription:
    "Install a plugin package to add a new capability. Your learning workspace works without plugins.",
  unavailable:
    "Open this page in the updated XueLearn Desktop app to manage plugins.",
  disabled: "Disabled",
  activating: "Starting",
  active: "Active",
  stopping: "Stopping",
  failed: "Failed",
  enable: "Enable",
  trustEnable: "Trust and enable",
  disable: "Disable",
  retry: "Retry",
  remove: "Remove",
  removeHint: "Disable the plugin before removing it.",
  trustHint:
    "This plugin contains executable code. Only enable plugins from a source you trust.",
  required: "Required capabilities",
  missing: "Unavailable capabilities",
  commands: "Plugin actions",
  displayPackages: "Included display packages",
  displayTitle: "Display plugins and previews",
  displayDescription:
    "Preview general, math, music, physics, code and media components for courses and videos.",
  displayLink: "Browse previews",
  installedNotice:
    "Plugin installed. Review its capabilities, then enable it when ready.",
  enabledNotice: "Plugin enabled.",
  disabledNotice: "Plugin disabled.",
  removedNotice: "Plugin removed.",
  executedNotice: "Plugin action completed.",
  actionFailed:
    "The plugin action failed. Try refreshing for its latest status.",
  viewTitle: "Plugin view",
  backToPlugins: "Back to plugins",
  backToContent: "Back to learning",
  viewInactive: "Enable this plugin to open its view.",
  viewMissing: "This plugin view is no longer available.",
  viewInvalid: "The plugin must export createView(host) returning a React component.",
  viewStyleFailed: "The plugin stylesheet could not be loaded. Reopen the view to retry.",
};

type PluginMessages = { [K in keyof typeof en]: string };

const zhHans: PluginMessages = {
  title: "桌面插件",
  manage: "管理桌面插件",
  description: "为学习工作区添加视频制作、工具和其他扩展能力。",
  install: "安装本地插件",
  installHint:
    "选择插件包文件夹。新插件安装后默认停用，检查插件说明后即可启用。",
  refresh: "刷新",
  loading: "正在加载插件…",
  working: "正在处理…",
  emptyTitle: "尚未安装桌面插件",
  emptyDescription:
    "安装插件包即可添加新能力。未安装插件时，学习工作区也可以正常使用。",
  unavailable: "请在更新后的 XueLearn Desktop 应用中打开此页面，以管理插件。",
  disabled: "已停用",
  activating: "正在启动",
  active: "已启用",
  stopping: "正在停止",
  failed: "运行失败",
  enable: "启用",
  trustEnable: "信任并启用",
  disable: "停用",
  retry: "重试",
  remove: "移除",
  removeHint: "请先停用插件，再移除。",
  trustHint: "此插件包含可执行代码。请仅启用来自可信来源的插件。",
  required: "所需能力",
  missing: "暂不可用的能力",
  commands: "插件功能",
  displayPackages: "附带的展示插件包",
  displayTitle: "展示插件与预览",
  displayDescription: "先看效果，再选择展示方式。浏览通用、数学、音乐、物理、代码与媒体组件。",
  displayLink: "打开插件库与预览",
  installedNotice: "插件已安装。检查其所需能力后即可启用。",
  enabledNotice: "插件已启用。",
  disabledNotice: "插件已停用。",
  removedNotice: "插件已移除。",
  executedNotice: "插件操作已完成。",
  actionFailed: "插件操作失败，请刷新查看最新状态。",
  viewTitle: "插件界面",
  backToPlugins: "返回插件",
  backToContent: "返回学习正文",
  viewInactive: "请先启用插件，再打开它的界面。",
  viewMissing: "此插件界面已不可用。",
  viewInvalid: "插件需要导出 createView(host)，并返回 React 组件。",
  viewStyleFailed: "插件样式未能加载，请重新打开界面重试。",
};

const zhHant: PluginMessages = {
  title: "桌面外掛",
  manage: "管理桌面外掛",
  description: "為學習工作區加入影片製作、工具和其他擴充能力。",
  install: "安裝本機外掛",
  installHint:
    "選擇外掛套件資料夾。新外掛安裝後預設停用，檢查外掛說明後即可啟用。",
  refresh: "重新整理",
  loading: "正在載入外掛…",
  working: "正在處理…",
  emptyTitle: "尚未安裝桌面外掛",
  emptyDescription:
    "安裝外掛套件即可加入新能力。未安裝外掛時，學習工作區也可以正常使用。",
  unavailable:
    "請在更新後的 XueLearn Desktop 應用程式中開啟此頁面，以管理外掛。",
  disabled: "已停用",
  activating: "正在啟動",
  active: "已啟用",
  stopping: "正在停止",
  failed: "執行失敗",
  enable: "啟用",
  trustEnable: "信任並啟用",
  disable: "停用",
  retry: "重試",
  remove: "移除",
  removeHint: "請先停用外掛，再移除。",
  trustHint: "此外掛包含可執行程式碼。請僅啟用來自可信來源的外掛。",
  required: "所需能力",
  missing: "暫時無法使用的能力",
  commands: "外掛功能",
  displayPackages: "附帶的展示外掛套件",
  displayTitle: "展示外掛與預覽",
  displayDescription: "先看效果，再選擇展示方式。瀏覽通用、數學、音樂、物理、程式碼與媒體元件。",
  displayLink: "開啟外掛庫與預覽",
  installedNotice: "外掛已安裝。檢查其所需能力後即可啟用。",
  enabledNotice: "外掛已啟用。",
  disabledNotice: "外掛已停用。",
  removedNotice: "外掛已移除。",
  executedNotice: "外掛操作已完成。",
  actionFailed: "外掛操作失敗，請重新整理以查看最新狀態。",
  viewTitle: "外掛介面",
  backToPlugins: "返回外掛",
  backToContent: "返回學習正文",
  viewInactive: "請先啟用外掛，再開啟它的介面。",
  viewMissing: "此外掛介面已無法使用。",
  viewInvalid: "外掛需要匯出 createView(host)，並回傳 React 元件。",
  viewStyleFailed: "外掛樣式無法載入，請重新開啟介面重試。",
};

export function pluginMessages(locale: string): PluginMessages {
  if (
    locale === "zh-Hant" ||
    locale.startsWith("zh-TW") ||
    locale.startsWith("zh-HK")
  )
    return zhHant;
  if (locale.startsWith("zh")) return zhHans;
  return en;
}
