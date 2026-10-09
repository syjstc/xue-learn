import type { LabVector3 } from "@xue-learn/core/source/libs/lab-engine/src/index.ts";

export type LabAssetLicense = "CC0-1.0" | "CC-BY-4.0";

export type LabAssetDefinition = {
  id: string;
  url: string;
  sourceUrl: string;
  author: string;
  license: LabAssetLicense;
  licenseUrl: string;
  intendedComponentType: string;
  scale: LabVector3;
  rotation?: LabVector3;
  position?: LabVector3;
  modifications: readonly string[];
};

function labAssetUrl(path: string) {
  const rawBase =
    (import.meta as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? "/";
  const base = rawBase.endsWith("/") ? rawBase : `${rawBase}/`;
  return `${base}${path.replace(/^\//, "")}`;
}

export const LAB_ASSETS = {
  "kenney-lab-desk": {
    id: "kenney-lab-desk",
    url: labAssetUrl("lab-assets/kenney-furniture-kit/desk.glb"),
    sourceUrl: "https://kenney.nl/assets/furniture-kit",
    author: "Kenney",
    license: "CC0-1.0",
    licenseUrl: "https://creativecommons.org/publicdomain/zero/1.0/",
    intendedComponentType: "lab_bench",
    scale: [3.4, 2.35, 2.25],
    rotation: [0, Math.PI / 2, 0],
    position: [0, -0.68, 0],
    modifications: [
      "Selected one model from the Furniture Kit",
      "Runtime scale, rotation, and placement normalized for the lab scene",
    ],
  },
} as const satisfies Record<string, LabAssetDefinition>;

export type LabAssetId = keyof typeof LAB_ASSETS;

export function getLabAsset(id: string) {
  return LAB_ASSETS[id as LabAssetId];
}

export function validateLabAssetCatalog() {
  return Object.values(LAB_ASSETS).flatMap((asset) => {
    const errors: string[] = [];
    if (!asset.url.includes("/lab-assets/")) errors.push(`${asset.id}: asset must be bundled`);
    if (!asset.sourceUrl.startsWith("https://")) errors.push(`${asset.id}: source URL is required`);
    if (!asset.author.trim()) errors.push(`${asset.id}: author is required`);
    return errors;
  });
}
