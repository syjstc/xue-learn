import { teachingPersonaVisualAvatarCode } from "@xue-learn/core/source/libs/domain/src/index.ts";

// Add or replace an entry only when the corresponding public asset changes.
const avatarVersions: Readonly<Record<string, string>> = {
  xiaohui_female: "ae965adf5bc2",
  ruiyan: "15fa3890ad83",
  ruiyan_female: "b127a06df1ce",
};

export function teachingPersonaAvatarSrc(avatarCode: string) {
  const visual = teachingPersonaVisualAvatarCode(avatarCode);
  const version = avatarVersions[visual];
  const path = `/teaching-personas/${visual}.webp`;
  return version ? `${path}?v=${version}` : path;
}

export function teachingPersonaStandingSrc(avatarCode: string) {
  const visual = teachingPersonaVisualAvatarCode(avatarCode);
  return `/scenario-theater/coaches/${visual}-standing.png`;
}
