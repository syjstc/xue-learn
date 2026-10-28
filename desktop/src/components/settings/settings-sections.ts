import {
  Activity,
  BrainCircuit,
  Palette,
  ShieldCheck,
  Sparkles,
  UserRound,
  Users,
} from "lucide-react";
import type { TranslationKey } from "@xue-learn/core/i18n";

export const SETTINGS_SECTIONS = [
  {
    id: "profile",
    labelKey: "settings.sections.profile",
    descriptionKey: "settings.sections.profileDescription",
    icon: UserRound,
  },
  {
    id: "state",
    labelKey: "settings.sections.state",
    descriptionKey: "settings.sections.stateDescription",
    icon: Activity,
  },
  {
    id: "persona",
    labelKey: "settings.sections.persona",
    descriptionKey: "settings.sections.personaDescription",
    icon: Users,
  },
  {
    id: "memory",
    labelKey: "settings.sections.memory",
    descriptionKey: "settings.sections.memoryDescription",
    icon: BrainCircuit,
  },
  {
    id: "experience",
    labelKey: "settings.sections.experience",
    descriptionKey: "settings.sections.experienceDescription",
    icon: Sparkles,
  },
  {
    id: "appearance",
    labelKey: "settings.sections.appearance",
    descriptionKey: "settings.sections.appearanceDescription",
    icon: Palette,
  },
  {
    id: "account",
    labelKey: "settings.sections.account",
    descriptionKey: "settings.sections.accountDescription",
    icon: ShieldCheck,
  },
] as const satisfies readonly {
  id: string;
  labelKey: TranslationKey;
  descriptionKey: TranslationKey;
  icon: typeof UserRound;
}[];

export type SettingsSectionId = (typeof SETTINGS_SECTIONS)[number]["id"];

const LEGACY_SETTINGS_SECTIONS: Record<string, SettingsSectionId> = {
  llm: "experience",
  image: "experience",
  features: "experience",
  memories: "memory",
};

export const LOCAL_SETTINGS_SECTION_IDS: readonly SettingsSectionId[] = [
  "profile",
  "state",
  "persona",
  "memory",
  "experience",
  "appearance",
];

export function settingsSectionPath(id: SettingsSectionId) {
  return id === "profile" ? "/settings" : `/settings?tab=${id}`;
}

export function resolveSettingsSection(
  value: string | null,
): SettingsSectionId {
  if (value && SETTINGS_SECTIONS.some((section) => section.id === value)) {
    return value as SettingsSectionId;
  }
  return (value && LEGACY_SETTINGS_SECTIONS[value]) || "profile";
}
