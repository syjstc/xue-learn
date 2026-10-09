import { createHash } from "node:crypto";
import type { EntityManager } from "@mikro-orm/core";
import type { CourseSourceReadPort } from "@xue-learn/core/source/libs/domain/src/persistence/course-source-port.ts";
import { courseSourceSnapshotSchema, type CourseSourceAssetV1, type CourseSourceSnapshotV1 } from "@xue-learn/core/source/libs/runtime-contracts/src/index.ts";

type Row = Record<string, unknown>;
type AssetReader = (unitId: string, imageId: string) => Promise<{ data: Uint8Array; mimeType: string } | null>;
const record = (value: unknown): Row => value && typeof value === "object" && !Array.isArray(value) ? value as Row : {};
const parse = (value: unknown): unknown => {
  if (value == null) return null;
  if (typeof value !== "string") return value;
  try { return JSON.parse(value); } catch { throw new Error("COURSE_SOURCE_INVALID_JSON: Published course JSON cannot be read intact"); }
};
export function canonicalCourseSource(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalCourseSource).join(",")}]`;
  return `{${Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    .map(([k, v]) => `${JSON.stringify(k)}:${canonicalCourseSource(v)}`).join(",")}}`;
}
const hash = (value: unknown) => createHash("sha256").update(canonicalCourseSource(value)).digest("hex");
const localImage = /^\/api\/units\/([^/]+)\/images\/(ill-(?:\d+-[a-f0-9]+|guided-[a-f0-9]{64}))\.(?:png|jpe?g|webp)(?:\?.*)?$/;
/** Hash published facts, including original cues and all derivation steps. */
export function courseSourceContentHash(snapshot: Omit<CourseSourceSnapshotV1, "snapshotId" | "contentHash" | "capturedAt">): string {
  return hash({ ...snapshot, sections: snapshot.sections.map(({ generationStatus: _, testGenerationStatus: __, ...section }) => section) });
}

export class CourseSourceRepository implements CourseSourceReadPort {
  constructor(private readonly em: EntityManager, private readonly readRawAsset: AssetReader,
    private readonly now = () => new Date(), private readonly maxBytes = 64 * 1024 * 1024,
    private readonly readTransaction?: <T>(work: (em: EntityManager) => Promise<T>) => Promise<T>) {}
  private table(em: EntityManager, name: string) {
    const schema = em.schema ?? em.config?.getSchema();
    return `${schema ? `"${schema.replaceAll('"', '""')}".` : ""}"${name}"`;
  }
  async readCatalog(input: { workspaceId: string; ownerId: string }) {
    const em = this.em.fork();
    const t = (name: string) => this.table(em, name);
    const units = await em.getConnection().execute(`SELECT u."id" AS "unitId", u."goalId", u."moduleId", u."title", u."unitKind", u."orderIndex", u."contentRevision", g."title" AS "goalTitle", g."contentLanguage", m."orderIndex" AS "moduleOrderIndex"
      FROM ${t("LearningUnit")} u JOIN ${t("LearningGoal")} g ON g."id"=u."goalId" LEFT JOIN ${t("LearningModule")} m ON m."id"=u."moduleId"
      WHERE g."userId"=? ORDER BY g."id", m."orderIndex", u."orderIndex", u."id"`, [input.ownerId]) as Row[];
    return units.map(unit => ({...unit, workspaceId: input.workspaceId}));
  }
  private async projection(input: { ownerId: string; unitId: string }) {
    return (this.readTransaction ?? ((work) => this.em.fork().transactional(work)))(async em => {
      const t = (name: string) => this.table(em, name);
      const query = async (sql: string, params: unknown[] = []): Promise<Row[]> =>
        await em.getConnection().execute(sql, params, undefined, em.getTransactionContext()) as Row[];
      const header = (await query(`SELECT u."id", u."goalId", u."moduleId", u."orderIndex", u."title", u."unitKind", u."contentSummary", u."contentRevision",
        g."title" AS "goalTitle", g."goalKind", g."contentLanguage", m."orderIndex" AS "moduleOrderIndex", ss."sq3rData",
        (SELECT COUNT(*) FROM ${t("AiGenerationRun")} r WHERE r."scopeId"=u."id" AND r."operation"='unit.generate_sq' AND r."status"='running') AS "previewPublishing",
        lm."introduction" AS "legacyIntroduction", lm."sections" AS "legacySections", lm."keyTakeaways" AS "legacyKeyTakeaways"
        FROM ${t("LearningUnit")} u JOIN ${t("LearningGoal")} g ON g."id"=u."goalId"
        LEFT JOIN ${t("LearningModule")} m ON m."id"=u."moduleId"
        LEFT JOIN ${t("UnitSessionState")} ss ON ss."unitId"=u."id"
        LEFT JOIN ${t("LearningMaterial")} lm ON lm."unitId"=u."id"
        WHERE u."id"=? AND g."userId"=? LIMIT 1`, [input.unitId, input.ownerId]))[0];
      if (!header) return null;
      const sectionRows = await query(`SELECT s."id", s."orderIndex", s."title", s."contentSummary", s."contentKind", s."generationStatus", s."assessmentAfter", s."testGenerationStatus", s."contentRevision", s."derivationFormat",
        m."id" AS "materialId", m."introduction", m."blocks", m."keyTakeaways", d."documentJson",
        td."documentJson" AS "teachingDocumentJson", td."derivedJson", td."parserVersion", td."analyzerVersion", td."matcherVersion", td."compilerVersion"
        FROM ${t("MainCourseSection")} s LEFT JOIN ${t("UnitSectionMaterial")} m ON m."sectionId"=s."id"
        LEFT JOIN ${t("UnitSectionDerivation")} d ON d."sectionId"=s."id"
        LEFT JOIN ${t("UnitSectionTeachingDerivation")} td ON td."sectionId"=s."id"
        WHERE s."unitId"=? ORDER BY s."orderIndex", s."id"`, [input.unitId]);
      const learningTargets = await query(`SELECT lt."id", lt."title", lt."explanation", lt."learningObjective", lt."assessmentCriteria", lt."language", lt."definitionVersion",
        ult."orderIndex", ult."localRef", ult."role", ult."required", ult."weight"
        FROM ${t("UnitLearningTarget")} ult JOIN ${t("LearningTarget")} lt ON lt."id"=ult."learningTargetId"
        WHERE ult."unitId"=? AND lt."goalId"=? ORDER BY ult."orderIndex", lt."id"`, [input.unitId, header.goalId]);
      const savedPreview = record(parse(header.sq3rData));
      // The session row also holds learner state. Only the original Survey and
      // authored guiding questions belong to the portable course preview.
      const preview = Object.fromEntries(["survey", "questions"].filter(key => key in savedPreview).map(key => [key, savedPreview[key]]));
      const sections = sectionRows.map(row => ({
        id: String(row.id), orderIndex: Number(row.orderIndex), title: String(row.title), scope: String(row.contentSummary ?? ""),
        contentKind: String(row.contentKind ?? "standard"), assessmentAfter: row.assessmentAfter === true || row.assessmentAfter === 1,
        testGenerationStatus: String(row.testGenerationStatus ?? "pending"), generationStatus: String(row.generationStatus ?? "pending"),
        publishedRevision: Number(row.contentRevision ?? 0), availability: row.materialId != null || row.documentJson != null || row.teachingDocumentJson != null ? "published" as const : "missing" as const,
        derivationFormat: row.derivationFormat == null ? null : String(row.derivationFormat),
        material: row.materialId == null ? null : { introduction: String(row.introduction ?? ""), blocks: parse(row.blocks) ?? [], keyTakeaways: parse(row.keyTakeaways) ?? [] },
        derivationDocument: parse(row.documentJson), teachingDerivationDocument: parse(row.teachingDocumentJson), teachingDerivationDerived: parse(row.derivedJson),
        presentationVersions: Object.fromEntries(["parserVersion", "analyzerVersion", "matcherVersion", "compilerVersion"].filter(key => row[key] != null).map(key => [key, String(row[key])])),
      }));
      const hasAcceptedBody = sections.some(section => section.derivationDocument != null || section.teachingDerivationDocument != null ||
        section.material && (section.material.introduction.trim() || Array.isArray(section.material.blocks) && section.material.blocks.length > 0)) ||
        header.legacySections != null && Array.isArray(parse(header.legacySections)) && (parse(header.legacySections) as unknown[]).length > 0;
      return {
        contractVersion: "course-source.v1" as const,
        source: { workspaceId: "", ownerId: input.ownerId, goalId: String(header.goalId), moduleId: header.moduleId == null ? null : String(header.moduleId),
          unitId: String(header.id), moduleOrderIndex: header.moduleOrderIndex == null ? null : Number(header.moduleOrderIndex), unitOrderIndex: Number(header.orderIndex) },
        metadata: { goalTitle: String(header.goalTitle), goalKind: String(header.goalKind), title: String(header.title), unitKind: String(header.unitKind),
          contentLanguage: String(header.contentLanguage ?? "auto"), scope: String(header.contentSummary ?? ""), publishedRevision: Number(header.contentRevision),
          learningTargets: learningTargets.map(row => ({...row, assessmentCriteria: parse(row.assessmentCriteria) ?? []})) },
        preview: { status: header.unitKind === "overview" ? "not-required" as const : Number(header.previewPublishing) > 0 && !hasAcceptedBody ? "pending" as const : Object.keys(record(preview.survey)).length ? "ready" as const : "missing" as const,
          data: Object.keys(preview).length ? preview : null },
        sections,
        legacyMaterial: header.legacySections == null && header.legacyIntroduction == null && header.legacyKeyTakeaways == null ? null : {
          introduction: String(header.legacyIntroduction ?? ""), sections: parse(header.legacySections) ?? [], keyTakeaways: parse(header.legacyKeyTakeaways) ?? [] },
      };
    });
  }
  async readUnit(input: { workspaceId: string; ownerId: string; unitId: string }): Promise<CourseSourceSnapshotV1 | null> {
    const data = await this.projection(input);
    if (!data) return null;
    data.source.workspaceId = input.workspaceId;
    const assets: CourseSourceAssetV1[] = [];
    const sources = new Set<string>();
    const scan = (value: unknown, key?: string) => {
      if (typeof value === "string" && (localImage.test(value) || key === "src" && value.length > 0 && !value.startsWith("data:"))) sources.add(value);
      else if (Array.isArray(value)) value.forEach(item => scan(item));
      else if (value && typeof value === "object") Object.entries(value).forEach(([k, v]) => scan(v, k));
    };
    scan(data);
    for (const source of [...sources].sort()) {
      const match = localImage.exec(source);
      if (!match) { assets.push({ resourceId: `external:${hash(source)}`, source, sha256: null, mediaType: null, byteLength: null, availability: /^https?:\/\//.test(source) ? "external" : "missing" }); continue; }
      if (decodeURIComponent(match[1]!) !== input.unitId) throw new Error("COURSE_SOURCE_ASSET_SCOPE: Course references an asset outside its unit");
      const asset = await this.readRawAsset(input.unitId, match[2]!);
      assets.push({ resourceId: `unit-image:${match[2]}`, source, sha256: asset ? createHash("sha256").update(asset.data).digest("hex") : null,
        mediaType: asset?.mimeType ?? null, byteLength: asset?.data.byteLength ?? null, availability: asset ? "available" : "missing" });
    }
    const verified = await this.projection(input);
    if (!verified) throw new Error("COURSE_SOURCE_CHANGED: Course was deleted during snapshot collection; retry");
    verified.source.workspaceId = input.workspaceId;
    if (courseSourceContentHash({...data, assets: []}) !== courseSourceContentHash({...verified, assets: []}))
      throw new Error("COURSE_SOURCE_CHANGED: Published content changed during snapshot collection; retry");
    const facts = {...data, assets};
    const bytes = Buffer.byteLength(canonicalCourseSource(facts));
    if (bytes > this.maxBytes) throw new Error(`COURSE_SOURCE_CAPACITY: Complete snapshot is ${bytes} bytes; supported capacity is ${this.maxBytes}. No content was truncated`);
    const contentHash = courseSourceContentHash(facts);
    return courseSourceSnapshotSchema.parse({...facts, contentHash, snapshotId: `course-source.v1:${contentHash}`, capturedAt: this.now().toISOString()});
  }
  async readAsset(input: { ownerId: string; unitId: string; resourceId: string; sha256: string }) {
    if (!/^unit-image:ill-(?:\d+-[a-f0-9]+|guided-[a-f0-9]{64})$/.test(input.resourceId) || !/^[a-f0-9]{64}$/.test(input.sha256)) return null;
    // Ownership is checked on every resource request; an old snapshot is no authority.
    const data = await this.projection(input);
    if (!data) return null;
    const sourceJson = canonicalCourseSource(data);
    const imageId = input.resourceId.slice("unit-image:".length);
    if (!sourceJson.includes(`/api/units/${input.unitId}/images/${imageId}.`)) return null;
    const asset = await this.readRawAsset(input.unitId, imageId);
    if (!asset) return null;
    // Asset IO is outside the short DB fence. Recheck ownership/reference after
    // it completes so a concurrent transfer/delete cannot authorize old pixels.
    const verified = await this.projection(input);
    if (!verified || !canonicalCourseSource(verified).includes(`/api/units/${input.unitId}/images/${imageId}.`))
      throw new Error("COURSE_SOURCE_CHANGED: Asset ownership or published reference changed during read; refresh the snapshot");
    if (createHash("sha256").update(asset.data).digest("hex") !== input.sha256)
      throw new Error("COURSE_SOURCE_ASSET_CHANGED: Asset hash differs from the saved snapshot; read a fresh snapshot");
    return { data: asset.data, mediaType: asset.mimeType };
  }
}
