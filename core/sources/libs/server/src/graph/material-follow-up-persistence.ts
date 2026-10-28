import type { MaterialFollowUpRepository } from "../../../domain/src/index.js";
let repository: MaterialFollowUpRepository | null = null;
export function configureMaterialFollowUpPersistence(next: MaterialFollowUpRepository | null): void { repository = next; }
export function requireMaterialFollowUpPersistence(): MaterialFollowUpRepository { if (!repository) throw new Error("Material follow-up persistence is unavailable"); return repository; }
