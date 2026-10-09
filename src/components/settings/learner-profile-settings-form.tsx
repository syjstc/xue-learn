"use client";

import { LearnerProfileForm } from "@/components/profile/learner-profile-form";
import { useLearnerProfile } from "@/hooks/api/use-learner-profile";
import { useT } from "@xue-learn/core/source/src/shared/i18n/index.tsx";

export function LearnerProfileSettingsForm() {
  const t = useT();
  const { data, isPending, error } = useLearnerProfile();

  if (isPending) {
    return <p className="text-sm text-muted-foreground">{t("profile.loading")}</p>;
  }

  if (error) {
    return <p className="text-sm text-danger">{error.message || t("profile.loadFailed")}</p>;
  }

  if (!data?.profile) return null;

  return <LearnerProfileForm profile={data.profile} mode="settings" />;
}
