import {prepareDisplayBuildSnapshot, resolveDisplayBuilds} from "@xue-learn/core/server/display-build";
import {readingSourceFromCourse} from "@xue-learn/core/server/reading";
import { createHash, randomUUID } from "node:crypto";
import type {CourseTeachingReuse} from '@xue-learn/core/server/course-teaching';
import {adoptUnitImage} from '@xue-learn/core/server/images/storage';
import type { EntityManager } from "@mikro-orm/core";
import type { CourseSourceReadPort } from "@xue-learn/core/domain/persistence/course-source-port";
import { courseSourceSnapshotSchema, type CourseSourceAssetV1, type CourseSourceSnapshotV1 } from "@xue-learn/core/runtime-contracts";

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
  async readReadingSource(input: {ownerId: string; unitId: string}) {
    const course = await this.projection(input);
    return course ? readingSourceFromCourse(course) : null;
  }
  async readCatalog(input: { workspaceId: string; ownerId: string }) {
    const em = this.em.fork();
    const t = (name: string) => this.table(em, name);
    const units = await em.getConnection().execute(`SELECT u."id" AS "unitId", u."goalId", u."moduleId", u."title", u."unitKind", u."orderIndex", u."contentRevision", g."title" AS "goalTitle", g."goalKind", g."contentLanguage", m."orderIndex" AS "moduleOrderIndex", m."title" AS "moduleTitle",
      s."id" AS "spaceId", s."name" AS "spaceName", s."purpose" AS "spacePurpose", s."sortIndex" AS "spaceOrderIndex", CASE WHEN s."id" IS NOT NULL THEN i."sortIndex" END AS "goalOrderIndex"
      FROM ${t("LearningUnit")} u JOIN ${t("LearningGoal")} g ON g."id"=u."goalId" LEFT JOIN ${t("LearningModule")} m ON m."id"=u."moduleId"
      LEFT JOIN ${t("LearningSpaceItem")} i ON i."goalId"=g."id" AND i."itemType"='goal'
      LEFT JOIN ${t("LearningSpace")} s ON s."id"=i."spaceId" AND s."userId"=g."userId"
      WHERE g."userId"=? ORDER BY g."id", m."orderIndex", u."orderIndex", u."id"`, [input.ownerId]) as Row[];
    return units.map(unit => ({...unit, workspaceId: input.workspaceId}));
  }
  private async projection(input: { ownerId: string; unitId: string }, transaction?: EntityManager) {
    const project = async (em: EntityManager) => {
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
    };
    return transaction ? project(transaction) : (this.readTransaction ?? ((work) => this.em.fork().transactional(work)))(project);
  }
  async readUnit(input: { workspaceId: string; ownerId: string; unitId: string }): Promise<CourseSourceSnapshotV1 | null> {
    return this.snapshot(input, true);
  }
  async readTeachingDraft(input: { workspaceId: string; ownerId: string; unitId: string }): Promise<CourseSourceSnapshotV1 | null> {
    return this.snapshot(input, false);
  }
  private async snapshot(input: { workspaceId: string; ownerId: string; unitId: string }, ready: boolean): Promise<CourseSourceSnapshotV1 | null> {
    const rawData = await this.projection(input);
    if (!rawData) return null;
    rawData.source.workspaceId = input.workspaceId;
    const data = ready ? await prepareDisplayBuildSnapshot(rawData, input.ownerId) : await resolveDisplayBuilds(rawData, input.ownerId);
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
    if (courseSourceContentHash({...rawData, assets: []}) !== courseSourceContentHash({...verified, assets: []}))
      throw new Error("COURSE_SOURCE_CHANGED: Published content changed during snapshot collection; retry");
    const facts = {...data, assets};
    const bytes = Buffer.byteLength(canonicalCourseSource(facts));
    if (bytes > this.maxBytes) throw new Error(`COURSE_SOURCE_CAPACITY: Complete snapshot is ${bytes} bytes; supported capacity is ${this.maxBytes}. No content was truncated`);
    const contentHash = courseSourceContentHash(facts);
    return courseSourceSnapshotSchema.parse({...facts, contentHash, snapshotId: `course-source.v1:${contentHash}`, capturedAt: this.now().toISOString()});
  }
  async adoptTeachingMaterial(input: {workspaceId: string; ownerId: string; unitId: string}, reuse: CourseTeachingReuse): Promise<void> {
    const rawBefore = await this.projection(input);
    if (!rawBefore) throw Error('Course source not found');
    const before = await this.readTeachingDraft(input);
    if (!before) throw Error('Course source not found');
    const wholeUnit = before.sections.length === 0 && reuse.sections.length === 1 && reuse.sections[0]!.sectionId === input.unitId;
    const hasLegacy = before.legacyMaterial && (before.legacyMaterial.introduction.trim() || Array.isArray(before.legacyMaterial.sections) && before.legacyMaterial.sections.length);
    const candidates = wholeUnit ? hasLegacy ? [] : reuse.sections : reuse.sections.filter(candidate => before.sections.find(section => section.id === candidate.sectionId)?.availability === 'missing');
    if (!wholeUnit && reuse.sections.some(candidate => !before.sections.some(section => section.id === candidate.sectionId))) throw Error('Accepted teaching belongs to another course section');
    if (!candidates.length) return; // An interrupted response can safely retry.
    if (before.contentHash !== reuse.expectedContentHash) throw Error('Course changed before teaching adoption; reread its source');
    const fingerprint = hash(rawBefore);
    for (const asset of reuse.assets ?? []) {
      const referenced = candidates.some(candidate => canonicalCourseSource(candidate.material).includes(`/api/units/${input.unitId}/images/${asset.imageId}.`));
      if (!referenced) throw Error('Accepted image is not referenced by this teaching content');
      const data = Buffer.from(asset.data, 'base64');
      if (data.length > 32 * 1024 * 1024 || data.toString('base64') !== asset.data) throw Error('Invalid accepted course image bytes');
      await adoptUnitImage(input.unitId, {...asset, data, mimeType: asset.mediaType});
    }
    for (const candidate of candidates) {
      const sources = canonicalCourseSource(candidate.material).match(/\/api\/units\/[^"\\\s]+\/images\/ill-(?:guided-[a-f0-9]{64}|\d+-[a-f0-9]+)\.(?:png|jpe?g|webp)/g) ?? [];
      for (const source of sources) {
        const match = localImage.exec(source)!;
        if (decodeURIComponent(match[1]!) !== input.unitId || !await this.readRawAsset(input.unitId, match[2]!)) throw Error('Accepted course image is missing or belongs to another unit');
      }
    }
    await (this.readTransaction ?? ((work) => this.em.fork().transactional(work)))(async em => {
      const current = await this.projection(input, em);
      if (!current || hash(current) !== fingerprint) throw Error('Course changed during teaching adoption; retry with the current source');
      const t = (name: string) => this.table(em, name);
      const execute = (sql: string, params: unknown[]) => em.getConnection().execute(sql, params, undefined, em.getTransactionContext());
      for (const candidate of candidates) {
        if (wholeUnit) {
          const now = this.now().toISOString();
          await execute(`INSERT INTO ${t('LearningMaterial')} ("id","unitId","introduction","sections","keyTakeaways","contextSources","createdAt","updatedAt") VALUES (?,?,?,?,?,'[]',?,?) ON CONFLICT ("unitId") DO UPDATE SET "introduction"=excluded."introduction","sections"=excluded."sections","keyTakeaways"=excluded."keyTakeaways","updatedAt"=excluded."updatedAt"`,
            [randomUUID(), input.unitId, candidate.material.introduction, JSON.stringify(candidate.material.blocks), JSON.stringify(candidate.material.keyTakeaways), now, now]);
          continue;
        }
        const section = current.sections.find(section => section.id === candidate.sectionId)!;
        if (section.availability !== 'missing' || ['building', 'running'].includes(section.generationStatus)) throw Error('Course teaching is already being prepared');
        const now = this.now().toISOString();
        await execute(`INSERT INTO ${t('UnitSectionMaterial')} ("id","sectionId","introduction","blocks","keyTakeaways","contextSources","sourceItems","createdAt","updatedAt") VALUES (?,?,?,?,?,'[]','[]',?,?)`,
          [randomUUID(), candidate.sectionId, candidate.material.introduction, JSON.stringify(candidate.material.blocks), JSON.stringify(candidate.material.keyTakeaways), now, now]);
        await execute(`UPDATE ${t('UnitSection')} SET "generationStatus"='ready',"generationError"='',"generationToken"=NULL,"generationStartedAt"=NULL,"contentKind"='standard',"derivationFormat"=NULL,"contentRevision"="contentRevision"+1,"updatedAt"=? WHERE "id"=? AND "unitId"=?`, [now, candidate.sectionId, input.unitId]);
      }
      await execute(`UPDATE ${t('LearningUnit')} SET "contentRevision"="contentRevision"+1 WHERE "id"=?`, [input.unitId]);
    });
  }
  async readAsset(input: { ownerId: string; unitId: string; resourceId: string; sha256: string }) {
    if (!/^unit-image:ill-(?:\d+-[a-f0-9]+|guided-[a-f0-9]{64})$/.test(input.resourceId) || !/^[a-f0-9]{64}$/.test(input.sha256)) return null;
    // Ownership is checked on every resource request; an old snapshot is no authority.
    const data = await this.projection(input);
    if (!data) return null;
    const sourceJson = canonicalCourseSource(await resolveDisplayBuilds(data, input.ownerId));
    const imageId = input.resourceId.slice("unit-image:".length);
    if (!sourceJson.includes(`/api/units/${input.unitId}/images/${imageId}.`)) return null;
    const asset = await this.readRawAsset(input.unitId, imageId);
    if (!asset) return null;
    // Asset IO is outside the short DB fence. Recheck ownership/reference after
    // it completes so a concurrent transfer/delete cannot authorize old pixels.
    const verified = await this.projection(input);
    if (!verified || !canonicalCourseSource(await resolveDisplayBuilds(verified, input.ownerId)).includes(`/api/units/${input.unitId}/images/${imageId}.`))
      throw new Error("COURSE_SOURCE_CHANGED: Asset ownership or published reference changed during read; refresh the snapshot");
    if (createHash("sha256").update(asset.data).digest("hex") !== input.sha256)
      throw new Error("COURSE_SOURCE_ASSET_CHANGED: Asset hash differs from the saved snapshot; read a fresh snapshot");
    return { data: asset.data, mediaType: asset.mimeType };
  }
}
