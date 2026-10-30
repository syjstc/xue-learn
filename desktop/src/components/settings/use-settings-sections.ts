import { useT } from "@xue-learn/core/i18n";
import { isDesktopLocalRuntime } from "@xue-learn/core/client-runtime";
import {
  LOCAL_SETTINGS_SECTION_IDS,
  SETTINGS_SECTIONS,
  resolveSettingsSection,
} from "./settings-sections";
import {
  pluginUiIcons,
  useDesktopPluginUi,
  type PluginUiExtension,
} from "@/features/plugins/ui-extensions";

export type SettingsUiSection = {
  id: string;
  title: string;
  description: string;
  icon: (typeof SETTINGS_SECTIONS)[number]["icon"];
  plugin?: PluginUiExtension;
};

/** Settings page and both desktop/mobile navigation read the same live registry. */
export function useSettingsSections() {
  const t = useT();
  const { entries, ready, bridge } = useDesktopPluginUi();
  const local = isDesktopLocalRuntime();
  const sections: SettingsUiSection[] = SETTINGS_SECTIONS.filter(
    (section) => !local || LOCAL_SETTINGS_SECTION_IDS.includes(section.id),
  ).map((section) => ({
    id: section.id,
    title: t(section.labelKey),
    description: t(section.descriptionKey),
    icon: section.icon,
  }));
  if (local)
    sections.push(
      ...entries
        .filter((entry) => entry.contribution.slot === "settings.tabs")
        .map((entry) => ({
          id: entry.key,
          title: entry.contribution.title,
          description: entry.contribution.description ?? entry.pluginName,
          icon: pluginUiIcons[entry.contribution.icon ?? "puzzle"],
          plugin: entry,
        })),
    );
  return { sections, ready, bridge };
}

export function activeSettingsSection(
  requested: string | null,
  sections: SettingsUiSection[],
) {
  if (sections.some((section) => section.id === requested)) return requested!;
  const legacy = resolveSettingsSection(requested);
  return sections.some((section) => section.id === legacy) ? legacy : "profile";
}
