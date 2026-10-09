import {
  BookOpen,
  Coins,
  Database,
  KeyRound,
  ScrollText,
  TriangleAlert,
  Wrench,
  Cloud,
} from "lucide-react";
import type { TranslationKey } from "@xue-learn/core/i18n";
import { isDev } from "@xue-learn/core/dev";

export const LOCAL_CONTROL_SECTIONS = [
  {
    to: "/local/sync",
    labelKey: "desktop.deviceSettings.personalSync",
    icon: Cloud,
  },
  {
    to: "/local/resources",
    labelKey: "desktop.deviceSettings.resources",
    icon: Database,
  },
  {
    to: "/local/teaching-skills",
    labelKey: "desktop.deviceSettings.teachingSkills",
    icon: BookOpen,
  },
  {
    to: "/local/api-keys",
    labelKey: "desktop.deviceSettings.apiKeys",
    icon: KeyRound,
  },
  {
    to: "/local/token-usage",
    labelKey: "desktop.deviceSettings.tokenUsage",
    icon: Coins,
  },
  ...(isDev()
    ? [
        {
          to: "/local/logs/llm",
          labelKey: "desktop.deviceSettings.llmLogs" as const,
          icon: ScrollText,
        },
      ]
    : []),
  {
    to: "/local/logs/errors",
    labelKey: "desktop.deviceSettings.errorLogs",
    icon: TriangleAlert,
  },
  ...(isDev()
    ? [
        {
          to: "/local/maintenance",
          labelKey: "desktop.deviceSettings.runtime" as const,
          icon: Wrench,
        },
      ]
    : []),
] as const satisfies readonly {
  to: string;
  labelKey: TranslationKey;
  icon: typeof BookOpen;
}[];
