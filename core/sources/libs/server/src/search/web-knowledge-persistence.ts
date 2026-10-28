import type { WebKnowledgeRepository } from "../../../domain/src/index.js";
let configured: WebKnowledgeRepository | undefined;
export function configureWebKnowledgePersistence(repository: WebKnowledgeRepository): void { configured = repository; }
export function requireWebKnowledgePersistence(): WebKnowledgeRepository { if (!configured) throw new Error("Web-knowledge persistence is not configured"); return configured; }
