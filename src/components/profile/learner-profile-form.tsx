"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { Check, ChevronDown, Plus, Save, Search, X } from "lucide-react";
import { Button } from "@xue-learn/core/source/src/components/ui/button.tsx";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { ImeSafeForm } from "@/components/ui/ime-safe-form";
import { Textarea } from "@/components/ui/textarea";
import type {
  LearnerAgeRange,
  LearnerEducationLevel,
  LearnerKnowledgeLevel,
  LearnerProfile,
} from "@/hooks/api/use-learner-profile";
import { useSaveLearnerProfile } from "@/hooks/api/use-learner-profile";
import {
  COMMON_SKILLS,
  DOMAIN_GROUPS,
  DOMAIN_OPTIONS,
  POPULAR_DOMAINS,
  POPULAR_SKILLS,
  SKILL_GROUPS,
  type SkillOption,
} from "@/shared/domain/learner-profile-options";
import { cn } from "@xue-learn/core/source/src/shared/utils.ts";
import { useI18n, useT, type TranslationKey } from "@xue-learn/core/source/src/shared/i18n/index.tsx";
import { localizeProfileOption } from "@/shared/i18n/profile-options";

const AGE_OPTIONS: { value: LearnerAgeRange; label: string }[] = [
  { value: "18_24", label: "profile.age.18_24" },
  { value: "25_34", label: "profile.age.25_34" },
  { value: "35_44", label: "profile.age.35_44" },
  { value: "45_plus", label: "profile.age.45_plus" },
  { value: "prefer_not_to_say", label: "profile.preferNotToSay" },
];

const EDUCATION_OPTIONS: { value: LearnerEducationLevel; label: string }[] = [
  { value: "high_school", label: "profile.education.highSchool" },
  { value: "vocational", label: "profile.education.vocational" },
  { value: "undergraduate", label: "profile.education.undergraduate" },
  { value: "graduate", label: "profile.education.graduate" },
  { value: "self_taught", label: "profile.education.selfTaught" },
  { value: "prefer_not_to_say", label: "profile.preferNotToSay" },
];

const LEVEL_OPTIONS: { value: LearnerKnowledgeLevel; label: string }[] = [
  { value: "heard_of", label: "profile.level.heardOf" },
  { value: "basic", label: "profile.level.basic" },
  { value: "working", label: "profile.level.working" },
  { value: "strong", label: "profile.level.strong" },
];

function splitCustomSkills(value: string) {
  return value
    .split(/[，,\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function uniqueSkills(values: string[]) {
  return [...new Set(values.map((item) => item.trim()).filter(Boolean))];
}

function splitTextList(value: string) {
  return value
    .split(/[，,\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function skillKey(skill: string) {
  return skill.trim().toLocaleLowerCase();
}

function matchesGroupedQuery(
  category: string,
  label: string,
  query: string,
  localize: (value: string) => string = (value) => value,
) {
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) return true;
  return `${category} ${label} ${localize(category)} ${localize(label)}`
    .toLocaleLowerCase()
    .includes(normalized);
}

function skillMatchesQuery(
  skill: SkillOption,
  query: string,
  localize: (value: string) => string,
) {
  return matchesGroupedQuery(skill.category, skill.label, query, localize);
}

function selectedSkillLevel(
  profile: LearnerProfile,
  skill: string,
): LearnerKnowledgeLevel {
  return (
    profile.knowledgeItems.find(
      (item) => skillKey(item.topic) === skillKey(skill),
    )?.level ?? "basic"
  );
}

function GroupedMultiValueField({
  label,
  values,
  groups,
  allOptions,
  popularItems,
  placeholder,
  searchPlaceholder,
  createLabel,
  localize,
  onChange,
}: {
  label: string;
  values: string[];
  groups: { category: string; items: string[] }[];
  allOptions: string[];
  popularItems: string[];
  placeholder: string;
  searchPlaceholder: string;
  createLabel: string;
  localize: (value: string) => string;
  onChange: (values: string[]) => void;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const selected = new Set(values);
  const trimmedQuery = query.trim();
  const visibleGroups = groups
    .map((group) => ({
      ...group,
      items: group.items.filter((item) =>
        matchesGroupedQuery(group.category, item, query, localize),
      ),
    }))
    .filter((group) => group.items.length > 0);
  const visiblePopular = popularItems.filter((item) =>
    matchesGroupedQuery(t("profile.popular"), item, query, localize),
  );
  const canCreate =
    trimmedQuery.length > 0 &&
    !allOptions.some((option) => skillKey(option) === skillKey(trimmedQuery)) &&
    !values.some((value) => skillKey(value) === skillKey(trimmedQuery));

  const addValue = (value: string) => {
    onChange(uniqueSkills([...values, value]));
    setQuery("");
  };

  const removeValue = (value: string) => {
    onChange(values.filter((item) => item !== value));
  };

  const toggleValue = (value: string) => {
    if (selected.has(value)) {
      removeValue(value);
      return;
    }
    addValue(value);
  };

  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          render={
            <button
              type="button"
              className="flex min-h-10 w-full items-center justify-between gap-2 rounded-lg border border-input bg-background px-3 py-2 text-left text-sm shadow-xs transition hover:bg-muted"
            >
              <span className="flex flex-1 flex-wrap gap-1.5">
                {values.length > 0 ? (
                  values.map((value) => (
                    <Badge
                      key={value}
                      variant="outline"
                      className="h-6 rounded-lg bg-muted/40 pr-1"
                    >
                      {localize(value)}
                      <span
                        role="button"
                        tabIndex={0}
                        className="ml-1 inline-flex size-4 items-center justify-center rounded hover:bg-muted-foreground/15"
                        onClick={(event) => {
                          event.stopPropagation();
                          removeValue(value);
                        }}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            event.stopPropagation();
                            removeValue(value);
                          }
                        }}
                      >
                        <X className="size-3" aria-hidden />
                      </span>
                    </Badge>
                  ))
                ) : (
                  <span className="text-muted-foreground">{placeholder}</span>
                )}
              </span>
              <ChevronDown
                className="size-4 text-muted-foreground"
                aria-hidden
              />
            </button>
          }
        />
        <PopoverContent
          align="start"
          className="w-[min(520px,calc(100vw-2rem))] p-2"
        >
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={searchPlaceholder}
              className="pl-8"
            />
          </div>
          <div className="max-h-80 space-y-3 overflow-y-auto pt-2">
            {visiblePopular.length > 0 ? (
              <div className="space-y-2">
                <div className="px-1 text-xs font-medium text-muted-foreground">
                  {t("profile.popular")}
                </div>
                <div className="flex flex-wrap gap-2 px-1">
                  {visiblePopular.map((item) => {
                    const active = selected.has(item);
                    return (
                      <button
                        key={`popular-${item}`}
                        type="button"
                        onClick={() => toggleValue(item)}
                        className={cn(
                          "inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-sm transition",
                          active
                            ? "border-primary bg-primary text-primary-foreground"
                            : "border-border bg-background text-foreground hover:bg-muted",
                        )}
                      >
                        {active ? (
                          <Check className="size-3.5" aria-hidden />
                        ) : null}
                        {localize(item)}
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : null}
            {visibleGroups.map((group) => (
              <div key={group.category} className="space-y-1.5">
                <div className="px-1 text-xs font-medium text-muted-foreground">
                  {localize(group.category)}
                </div>
                {group.items.map((item) => {
                  const active = selected.has(item);
                  return (
                    <button
                      key={`${group.category}-${item}`}
                      type="button"
                      onClick={() => toggleValue(item)}
                      className={cn(
                        "flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm hover:bg-muted",
                        active ? "text-primary" : "text-foreground",
                      )}
                    >
                      <span
                        className={cn(
                          "flex size-4 items-center justify-center rounded border",
                          active
                            ? "border-primary bg-primary text-primary-foreground"
                            : "border-border",
                        )}
                      >
                        {active ? (
                          <Check className="size-3" aria-hidden />
                        ) : null}
                      </span>
                      {localize(item)}
                    </button>
                  );
                })}
              </div>
            ))}
            {canCreate ? (
              <button
                type="button"
                onClick={() => addValue(trimmedQuery)}
                className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm hover:bg-muted"
              >
                <Plus className="size-4 text-muted-foreground" aria-hidden />
                {createLabel} “{trimmedQuery}”
              </button>
            ) : null}
            {visibleGroups.length === 0 &&
            visiblePopular.length === 0 &&
            !canCreate ? (
              <div className="px-2 py-6 text-center text-sm text-muted-foreground">
                {t("profile.noMatches")}
              </div>
            ) : null}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}

function SkillPicker({
  selectedSkills,
  skillLevels,
  onToggleSkill,
  onSetLevel,
  localize,
}: {
  selectedSkills: string[];
  skillLevels: Record<string, LearnerKnowledgeLevel>;
  onToggleSkill: (skill: string) => void;
  onSetLevel: (skill: string, level: LearnerKnowledgeLevel) => void;
  localize: (value: string) => string;
}) {
  const t = useT();
  const [query, setQuery] = useState("");
  const visibleGroups = SKILL_GROUPS.map((group) => ({
    ...group,
    items: COMMON_SKILLS.filter(
      (skill) =>
        skill.category === group.category &&
          skillMatchesQuery(skill, query, localize),
      ),
  })).filter((group) => group.items.length > 0);
  const visiblePopular = POPULAR_SKILLS.filter((skill) =>
    matchesGroupedQuery(t("profile.popular"), skill, query, localize),
  );

  return (
    <div className="space-y-2">
      <Label>{t("profile.commonSkills")}</Label>
      <div className="rounded-lg border border-border p-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("profile.searchSkillsPlaceholder")}
            className="pl-8"
          />
        </div>
        <div className="mt-3 max-h-80 space-y-4 overflow-y-auto pr-1">
          {visiblePopular.length > 0 ? (
            <div className="space-y-2">
              <div className="text-sm font-medium text-foreground">
                {t("profile.popular")}
              </div>
              <div className="flex flex-wrap gap-2">
                {visiblePopular.map((skill) => {
                  const active = selectedSkills.includes(skill);
                  return (
                    <button
                      key={`popular-${skill}`}
                      type="button"
                      onClick={() => onToggleSkill(skill)}
                      className={cn(
                        "inline-flex h-9 items-center gap-1.5 rounded-lg border px-3 text-sm font-medium transition",
                        active
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-border bg-background text-foreground hover:bg-muted",
                      )}
                    >
                      {active ? <Check className="size-4" aria-hidden /> : null}
                      {localize(skill)}
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}
          {visibleGroups.map((group) => (
            <div key={group.category} className="space-y-2">
              <div className="text-sm font-medium text-foreground">
                {localize(group.category)}
              </div>
              <div className="flex flex-wrap gap-2">
                {group.items.map((skill) => {
                  const active = selectedSkills.includes(skill.label);
                  return (
                    <button
                      key={`${skill.category}-${skill.label}`}
                      type="button"
                      onClick={() => onToggleSkill(skill.label)}
                      className={cn(
                        "inline-flex h-9 items-center gap-1.5 rounded-lg border px-3 text-sm font-medium transition",
                        active
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-border bg-background text-foreground hover:bg-muted",
                      )}
                    >
                      {active ? <Check className="size-4" aria-hidden /> : null}
                      {localize(skill.label)}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
          {visibleGroups.length === 0 && visiblePopular.length === 0 ? (
            <div className="py-6 text-center text-sm text-muted-foreground">
              {t("profile.noMatches")}
            </div>
          ) : null}
        </div>
      </div>

      {selectedSkills.length > 0 ? (
        <div className="space-y-2 rounded-lg border border-border p-3">
          <div className="text-sm font-medium text-foreground">
            {t("profile.proficiency")}
          </div>
          <div className="space-y-2">
            {selectedSkills.map((skill) => (
              <div
                key={skill}
                className="flex flex-col gap-2 rounded-md bg-muted/35 p-2 sm:flex-row sm:items-center sm:justify-between"
              >
                <span className="text-sm font-medium">{localize(skill)}</span>
                <div className="flex flex-wrap gap-1">
                  {LEVEL_OPTIONS.map((level) => {
                    const active =
                      (skillLevels[skill] ?? "basic") === level.value;
                    return (
                      <button
                        key={`${skill}-${level.value}`}
                        type="button"
                        onClick={() => onSetLevel(skill, level.value)}
                        className={cn(
                          "h-7 rounded-md border px-2 text-xs font-medium transition",
                          active
                            ? "border-primary bg-primary text-primary-foreground"
                            : "border-border bg-background text-foreground hover:bg-muted",
                        )}
                      >
                        {t(level.label as TranslationKey)}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function LearnerProfileForm({
  profile,
  mode,
  onSaved,
}: {
  profile: LearnerProfile;
  mode: "onboarding" | "settings";
  onSaved?: (profile: LearnerProfile) => void;
}) {
  const t = useT();
  const { locale } = useI18n();
  const localize = (value: string) => localizeProfileOption(value, locale);
  const [nickname, setNickname] = useState(profile.nickname ?? "");
  const [ageRange, setAgeRange] = useState<LearnerAgeRange | undefined>(
    profile.ageRange,
  );
  const [educationLevel, setEducationLevel] = useState<
    LearnerEducationLevel | undefined
  >(profile.educationLevel);
  const [majorOrFields, setMajorOrFields] = useState<string[]>(
    splitTextList(profile.majorOrField ?? ""),
  );
  const [selectedSkills, setSelectedSkills] = useState<string[]>(
    profile.generalSkills,
  );
  const knownCommonSkills = useMemo(
    () => new Set(COMMON_SKILLS.map((skill) => skill.label)),
    [],
  );
  const [customSkills, setCustomSkills] = useState(
    profile.generalSkills
      .filter((skill) => !knownCommonSkills.has(skill))
      .join("，"),
  );
  const [customInfo, setCustomInfo] = useState(profile.customInfo ?? "");
  const [skillLevels, setSkillLevels] = useState<
    Record<string, LearnerKnowledgeLevel>
  >(() =>
    Object.fromEntries(
      profile.generalSkills
        .filter((skill) => knownCommonSkills.has(skill))
        .map((skill) => [skill, selectedSkillLevel(profile, skill)]),
    ),
  );
  const [message, setMessage] = useState("");
  const saveProfile = useSaveLearnerProfile();

  useEffect(() => {
    setNickname(profile.nickname ?? "");
    setAgeRange(profile.ageRange);
    setEducationLevel(profile.educationLevel);
    setMajorOrFields(splitTextList(profile.majorOrField ?? ""));
    setSelectedSkills(profile.generalSkills);
    setCustomSkills(
      profile.generalSkills
        .filter((skill) => !knownCommonSkills.has(skill))
        .join("，"),
    );
    setCustomInfo(profile.customInfo ?? "");
    setSkillLevels(
      Object.fromEntries(
        profile.generalSkills
          .filter((skill) => knownCommonSkills.has(skill))
          .map((skill) => [skill, selectedSkillLevel(profile, skill)]),
      ),
    );
  }, [knownCommonSkills, profile]);

  const toggleSkill = (skill: string) => {
    setSelectedSkills((current) =>
      current.includes(skill)
        ? current.filter((item) => item !== skill)
        : [...current, skill],
    );
    setSkillLevels((current) => ({
      ...current,
      [skill]: current[skill] ?? selectedSkillLevel(profile, skill),
    }));
  };

  const setSkillLevel = (skill: string, level: LearnerKnowledgeLevel) => {
    setSkillLevels((current) => ({ ...current, [skill]: level }));
  };

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    const commonSkills = selectedSkills.filter((skill) =>
      knownCommonSkills.has(skill),
    );
    const profileSkills = uniqueSkills([
      ...commonSkills,
      ...splitCustomSkills(customSkills),
    ]);
    const now = new Date().toISOString();
    const knownCommonSkillKeys = new Set(
      COMMON_SKILLS.map((skill) => skillKey(skill.label)),
    );
    const retainedKnowledgeItems = profile.knowledgeItems.filter(
      (item) =>
        !knownCommonSkillKeys.has(skillKey(item.topic)) &&
        (item.source === "onboarding" || item.source === "manual"),
    );
    const nextKnowledgeItems = [
      ...retainedKnowledgeItems,
      ...commonSkills.map((skill) => ({
        topic: skill,
        domain: COMMON_SKILLS.find((option) => option.label === skill)
          ?.category,
        level: skillLevels[skill] ?? "basic",
        confidence: "user_stated" as const,
        source:
          mode === "onboarding" ? ("onboarding" as const) : ("manual" as const),
        updatedAt: now,
      })),
    ].slice(-80);

    try {
      const result = await saveProfile.mutateAsync({
        onboardingCompleted: true,
        nickname: nickname.trim(),
        ageRange,
        educationLevel,
        majorOrField: majorOrFields.join("，"),
        customInfo: customInfo.trim(),
        generalSkills: profileSkills,
        knowledgeItems: nextKnowledgeItems,
      });
      setMessage(mode === "onboarding" ? "" : t("profile.saved"));
      onSaved?.(result.profile);
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : t("profile.saveFailed"),
      );
    }
  }

  return (
    <ImeSafeForm className="space-y-5" onSubmit={handleSubmit}>
      <p className="text-sm text-muted-foreground">
        {t("profile.adultNotice")}
      </p>
      <div className="space-y-1.5">
        <Label htmlFor="learner-nickname">{t("profile.nicknameLabel")}</Label>
        <Input
          id="learner-nickname"
          value={nickname}
          maxLength={40}
          onChange={(event) => setNickname(event.target.value.slice(0, 40))}
          placeholder={t("profile.nicknamePlaceholder")}
        />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label>{t("profile.ageLabel")}</Label>
          <Select
            items={AGE_OPTIONS.map((option) => ({
              ...option,
              label: t(option.label as TranslationKey),
            }))}
            value={ageRange}
            onValueChange={(value) => setAgeRange(value as LearnerAgeRange)}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder={t("profile.agePlaceholder")} />
            </SelectTrigger>
            <SelectContent>
              {AGE_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {t(option.label as TranslationKey)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label>{t("profile.educationLabel")}</Label>
          <Select
            items={EDUCATION_OPTIONS.map((option) => ({
              ...option,
              label: t(option.label as TranslationKey),
            }))}
            value={educationLevel}
            onValueChange={(value) =>
              setEducationLevel(value as LearnerEducationLevel)
            }
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder={t("profile.educationPlaceholder")} />
            </SelectTrigger>
            <SelectContent>
              {EDUCATION_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {t(option.label as TranslationKey)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <GroupedMultiValueField
        label={t("profile.fieldLabel")}
        values={majorOrFields}
        groups={DOMAIN_GROUPS}
        allOptions={DOMAIN_OPTIONS}
        popularItems={POPULAR_DOMAINS}
        placeholder={t("profile.fieldPlaceholder")}
        searchPlaceholder={t("profile.fieldSearchPlaceholder")}
        createLabel={t("profile.addField")}
        localize={localize}
        onChange={setMajorOrFields}
      />

      <SkillPicker
        selectedSkills={selectedSkills.filter((skill) =>
          knownCommonSkills.has(skill),
        )}
        skillLevels={skillLevels}
        onToggleSkill={toggleSkill}
        onSetLevel={setSkillLevel}
        localize={localize}
      />

      <div className="space-y-1.5">
        <Label htmlFor="custom-skills">{t("profile.otherSkills")}</Label>
        <Input
          id="custom-skills"
          value={customSkills}
          onChange={(event) => setCustomSkills(event.target.value)}
          placeholder={t("profile.otherSkillsPlaceholder")}
        />
      </div>

      <div className="space-y-1.5">
        <div className="flex items-center justify-between gap-2">
          <Label htmlFor="custom-info">{t("profile.customInfo")}</Label>
          <span className="text-xs text-muted-foreground">
            {customInfo.length}/500
          </span>
        </div>
        <Textarea
          id="custom-info"
          value={customInfo}
          maxLength={500}
          onChange={(event) => setCustomInfo(event.target.value.slice(0, 500))}
          placeholder={t("profile.customInfoPlaceholder")}
          className="min-h-24"
        />
      </div>

      {profile.knowledgeItems.filter(
        (item) => item.source === "onboarding" || item.source === "manual",
      ).length > 0 ? (
        <div className="space-y-2">
          <Label>{t("profile.recordedKnowledge")}</Label>
          <div className="flex flex-wrap gap-2">
            {profile.knowledgeItems
              .filter(
                (item) =>
                  item.source === "onboarding" || item.source === "manual",
              )
              .slice(-16)
              .map((item) => (
                <Badge
                  key={`${item.topic}-${item.updatedAt}`}
                  variant="outline"
                >
                  {localize(item.topic)} · {t(`profile.level.${item.level}` as TranslationKey)}
                </Badge>
              ))}
          </div>
        </div>
      ) : null}

      <div className="flex items-center gap-3">
        <Button
          type="submit"
          disabled={saveProfile.isPending || !nickname.trim()}
        >
          <Save className="mr-1.5 size-4" />
          {saveProfile.isPending
            ? t("profile.saving")
            : mode === "onboarding"
              ? t("profile.completeAndEnter")
              : t("profile.saveProfile")}
        </Button>
        {message ? (
          <span
            className={cn(
              "text-sm",
              message === t("profile.saved")
                ? "text-muted-foreground"
                : "text-danger",
            )}
          >
            {message}
          </span>
        ) : null}
      </div>
    </ImeSafeForm>
  );
}
