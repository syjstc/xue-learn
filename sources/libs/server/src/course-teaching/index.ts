import {z} from 'zod';
import type {CourseSourceSnapshotV1} from '../../../runtime-contracts/src/course-source.js';
import {assertDisplayBuildsReady, resolveDisplayBuilds, unfinishedDisplayBuilds} from '../display-build/material.js';
import {materialDisplayBlockSchema} from '../../../domain/src/material-display.js';

const block = z.object({type: z.string().min(1)}).catchall(z.unknown());
/** Previously accepted teaching can fill an empty course section, never replace it. */
export const courseTeachingReuseSchema = z.object({
  expectedContentHash: z.string().regex(/^[a-f0-9]{64}$/),
  sections: z.array(z.object({sectionId: z.string().min(1), material: z.object({
    introduction: z.string(), blocks: z.array(block).min(1), keyTakeaways: z.array(z.string()),
  }).strict()}).strict()).min(1),
  assets: z.array(z.object({imageId: z.string().regex(/^ill-(?:\d+-[a-f0-9]+|guided-[a-f0-9]{64})$/),
    mediaType: z.enum(['image/png', 'image/jpeg', 'image/webp']), sha256: z.string().regex(/^[a-f0-9]{64}$/),
    data: z.string().min(1),
  }).strict()).optional(),
}).strict().superRefine((value, ctx) => {
  if (new Set(value.sections.map(section => section.sectionId)).size !== value.sections.length)
    ctx.addIssue({code: 'custom', message: 'Teaching reuse section IDs must be unique'});
  for (const [sectionIndex, section] of value.sections.entries()) for (const [index, value] of section.material.blocks.entries()) {
    if (value.type === 'display') {
      const result = materialDisplayBlockSchema.safeParse(value);
      if (!result.success) ctx.addIssue({code: 'custom', path: ['sections', sectionIndex, 'material', 'blocks', index], message: result.error.message});
    }
  }
  try {assertDisplayBuildsReady(value);} catch (error) {
    ctx.addIssue({code: 'custom', message: error instanceof Error ? error.message : String(error)});
  }
});
export type CourseTeachingReuse = z.infer<typeof courseTeachingReuseSchema>;

export interface CourseTeachingContentDependencies {
  /** Draft reads resolve ready artifacts but may still contain pending builders. */
  readDraft(userId: string, unitId: string): Promise<CourseSourceSnapshotV1 | null>;
  readReady(userId: string, unitId: string): Promise<CourseSourceSnapshotV1 | null>;
  ensurePlan(unitId: string): Promise<unknown>;
  generateSection(input: {userId: string; unitId: string; sectionId: string; generationPurpose: 'course-production'}): Promise<unknown>;
  adopt?(userId: string, unitId: string, reuse: CourseTeachingReuse): Promise<void>;
  wait?: () => Promise<void>;
}
const hasBody = (source: CourseSourceSnapshotV1) => source.sections.some(section => section.availability === 'published')
  || !!source.legacyMaterial && Array.isArray(source.legacyMaterial.sections) && source.legacyMaterial.sections.length > 0;

/** Course-owned publication is the only content-generation path. Both learning
 * and video consume the resulting immutable source; a failed export cannot undo it. */
export class CourseTeachingContentService {
  private readonly active = new Map<string, Promise<CourseSourceSnapshotV1>>();
  constructor(private readonly dependencies: CourseTeachingContentDependencies) {}
  read(userId: string, unitId: string) {return this.draft(userId, unitId);}
  ensure(userId: string, unitId: string, reuse?: unknown): Promise<CourseSourceSnapshotV1> {
    const key = JSON.stringify([userId, unitId]);
    const current = this.active.get(key);
    if (current) return current;
    const work = this.prepare(userId, unitId, reuse).finally(() => {
      if (this.active.get(key) === work) this.active.delete(key);
    });
    this.active.set(key, work);
    return work;
  }
  private async draft(userId: string, unitId: string) {
    const source = await this.dependencies.readDraft(userId, unitId);
    if (!source || source.source.ownerId !== userId || source.source.unitId !== unitId) throw Error('Course source not found');
    return source;
  }
  private async prepare(userId: string, unitId: string, rawReuse?: unknown): Promise<CourseSourceSnapshotV1> {
    const started = Date.now();
    let source = await this.draft(userId, unitId);
    if (!hasBody(source) && source.preview.status !== 'ready' && source.preview.status !== 'not-required')
      throw Error('Course preview is not ready; prepare it in the learning host');
    if (source.legacyMaterial && Array.isArray(source.legacyMaterial.sections) && source.legacyMaterial.sections.length
      && !source.sections.some(section => section.availability === 'published')) {
      const ready = await this.dependencies.readReady(userId, unitId);
      if (!ready) throw Error('Course source not found');
      assertDisplayBuildsReady(ready);
      return ready;
    }
    if (rawReuse !== undefined) {
      const reuse = courseTeachingReuseSchema.parse(rawReuse);
      if (!this.dependencies.adopt) throw Error('This course connection cannot adopt accepted teaching');
      await this.dependencies.adopt(userId, unitId, reuse);
      source = await this.draft(userId, unitId);
    }
    // Older whole-unit materials already serve the learner. Do not author a
    // second body merely because they predate the section schema.
    if (!(source.sections.length === 0 && hasBody(source))) await this.dependencies.ensurePlan(unitId);
    source = await this.draft(userId, unitId);
    if (!source.sections.length && !hasBody(source)) throw Error('Course has no teaching section plan');
    const sectionIds = source.sections.map(section => section.id);
    for (const sectionId of sectionIds) {
      source = await this.draft(userId, unitId);
      if (JSON.stringify(source.sections.map(section => section.id)) !== JSON.stringify(sectionIds))
        throw Error('Course section plan changed during preparation; retry with the current course');
      const section = source.sections.find(section => section.id === sectionId)!;
      if (section.availability === 'published') continue;
      await this.dependencies.generateSection({userId, unitId, sectionId, generationPurpose: 'course-production'});
    }
    // Builders use the course workspace's existing durable jobs. They are
    // joined here, never recreated in a video-owned derivation repository.
    while (true) {
      source = await this.draft(userId, unitId);
      const resolved = await resolveDisplayBuilds(source, userId);
      const pending = unfinishedDisplayBuilds(resolved);
      if (pending.some(job => !['pending', 'running'].includes(job.status)))
        throw Error(`Course display build failed: ${pending.map(job => job.error || job.nodeId).join('; ')}`);
      if (!pending.length) break;
      if (Date.now() - started > 60 * 60_000) throw Error('Course display preparation is still pending; continue from the saved course jobs');
      await (this.dependencies.wait?.() ?? new Promise<void>(resolve => setTimeout(resolve, 500)));
    }
    if (source.sections.some(section => section.availability !== 'published')) throw Error('Course teaching publication is incomplete');
    const ready = await this.dependencies.readReady(userId, unitId);
    if (!ready || ready.source.ownerId !== userId || ready.source.unitId !== unitId) throw Error('Course source changed during publication');
    assertDisplayBuildsReady(ready);
    return ready;
  }
}
