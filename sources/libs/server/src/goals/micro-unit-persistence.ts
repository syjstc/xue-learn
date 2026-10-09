import type { MicroUnitPublicationRepository } from "../../../domain/src/index.js";
let repository: MicroUnitPublicationRepository | null = null;
export function configureMicroUnitPersistence(next: MicroUnitPublicationRepository | null): void { repository = next; }
export function requireMicroUnitPersistence(): MicroUnitPublicationRepository { if (!repository) throw new Error("Micro-unit persistence is unavailable"); return repository; }
