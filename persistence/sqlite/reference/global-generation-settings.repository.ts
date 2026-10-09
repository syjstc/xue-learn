import type { EntityManager } from "@mikro-orm/core";
import type { GlobalGenerationSettingsPatch, GlobalGenerationSettingsRepository, } from "@xue-learn/core/domain";
import { referenceDateValue } from "./date-value.ts";
type Row = Readonly<Record<string, unknown>>;
function rows(result: unknown): readonly Row[] {
    if (Array.isArray(result))
        return result as Row[];
    if (result && typeof result === "object" && "rows" in result) {
        const value = (result as {
            rows?: unknown;
        }).rows;
        return Array.isArray(value) ? (value as Row[]) : [];
    }
    return [];
}
function value(row: Row, key: string): unknown {
    return row[key] ?? row[key[0]?.toLowerCase() + key.slice(1)];
}
function table(em: EntityManager, name: string): string {
    const schema = em.schema ?? em.config?.getSchema();
    const quoted = `"${name.replaceAll('"', '""')}"`;
    return schema ? `"${schema.replaceAll('"', '""')}".${quoted}` : quoted;
}
function stringArray(raw: unknown): string[] {
    if (Array.isArray(raw))
        return raw.map(String);
    if (typeof raw !== "string")
        return [];
    try {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed.map(String) : [];
    }
    catch {
        return raw.startsWith("{") && raw.endsWith("}")
            ? raw.slice(1, -1).split(",").filter(Boolean)
            : [];
    }
}
export class MikroOrmGlobalGenerationSettingsRepository implements GlobalGenerationSettingsRepository {
    constructor(private readonly em: EntityManager) { }
    private execute(sql: string, params: unknown[] = []) {
        return this.em.getConnection().execute(sql, params, undefined, this.em.getTransactionContext());
    }
    private async ensure(): Promise<void> {
        const now = new Date();
        await this.execute(`INSERT INTO ${table(this.em, "GlobalGenerationSettings")} ("id", "createdAt", "updatedAt") VALUES (?, ?, ?) ON CONFLICT ("id") DO NOTHING`, ["global", now, now]);
    }
    async findUpdater(userId: string) {
        const row = rows(await this.execute(`SELECT "id", "name", "email" FROM ${table(this.em, "User")} WHERE "id" = ?`, [userId]))[0];
        return row
            ? {
                id: String(value(row, "id")),
                name: value(row, "name") == null ? null : String(value(row, "name")),
                email: String(value(row, "email")),
            }
            : null;
    }
    async get() {
        await this.ensure();
        const row = rows(await this.execute(`SELECT "imageProvider", "searchEnabled", "searchProvider", "chatAudioProvider", "openaiBaseUrl",
                "contentVerificationMode", "contentVerificationProvider", "contentVerificationModel",
                "disabledMaterialComponentTypes", "updatedAt", "updatedByUserId"
           FROM ${table(this.em, "GlobalGenerationSettings")} WHERE "id" = 'global'`))[0]!;
        return {
            imageProvider: String(value(row, "imageProvider") ?? "none"),
            searchEnabled: value(row, "searchEnabled") === true || Number(value(row, "searchEnabled")) === 1,
            searchProvider: String(value(row, "searchProvider") ?? "tavily"),
            chatAudioProvider: String(value(row, "chatAudioProvider") ?? "minimax"),
            openaiBaseUrl: String(value(row, "openaiBaseUrl") ?? "official"),
            contentVerificationMode: String(value(row, "contentVerificationMode") ?? "off"),
            contentVerificationProvider: String(value(row, "contentVerificationProvider") ?? "deepseek"),
            contentVerificationModel: String(value(row, "contentVerificationModel") ?? "deepseek-flash"),
            disabledMaterialComponentTypes: stringArray(value(row, "disabledMaterialComponentTypes")),
            updatedAt: referenceDateValue(value(row, "updatedAt"), "updatedAt"),
            updatedByUserId: value(row, "updatedByUserId") == null ? null : String(value(row, "updatedByUserId")),
        };
    }
    async update(patch: GlobalGenerationSettingsPatch) {
        await this.ensure();
        const allowed = [
            "imageProvider", "searchEnabled", "searchProvider", "chatAudioProvider", "openaiBaseUrl",
            "contentVerificationMode", "contentVerificationProvider", "contentVerificationModel",
            "disabledMaterialComponentTypes", "updatedByUserId",
        ] as const;
        const assignments: string[] = [];
        const params: unknown[] = [];
        for (const key of allowed) {
            if (!(key in patch) || patch[key] === undefined)
                continue;
            assignments.push(`"${key}" = ?`);
            const next = patch[key];
            params.push(key === "disabledMaterialComponentTypes"
                ?
                    JSON.stringify(next)
                : next);
        }
        if (assignments.length > 0) {
            assignments.push(`"updatedAt" = ?`);
            params.push(new Date());
            await this.execute(`UPDATE ${table(this.em, "GlobalGenerationSettings")} SET ${assignments.join(", ")} WHERE "id" = 'global'`, params);
        }
        return this.get();
    }
}
