import { BadRequestException, Body, Controller, Get, Inject, NotFoundException, Param, Post, Query, Res } from "@nestjs/common";
import type { Response } from "express";
import { CurrentUserId } from "@xue-learn/core/common";
import type { CourseSourceReadPort } from "@xue-learn/core/domain/persistence/course-source-port";
import type {CourseTeachingContentService} from '@xue-learn/core/server/course-teaching';
import {courseTeachingReuseSchema} from '@xue-learn/core/server/course-teaching';
export const LOCAL_COURSE_SOURCE_CONTEXT = Symbol("LOCAL_COURSE_SOURCE_CONTEXT");
export type LocalCourseSourceContext = { workspaceId: string; repository: CourseSourceReadPort; teaching?: CourseTeachingContentService };
@Controller("api/course-sources")
export class LocalCourseSourceController {
  constructor(@Inject(LOCAL_COURSE_SOURCE_CONTEXT) private readonly context: LocalCourseSourceContext) {}
  @Get("catalog")
  catalog(@CurrentUserId() ownerId: string) { return this.context.repository.readCatalog({workspaceId: this.context.workspaceId, ownerId}); }
  @Get("units/:unitId")
  async unit(@CurrentUserId() ownerId: string, @Param("unitId") unitId: string) {
    const source = await this.context.repository.readUnit({ workspaceId: this.context.workspaceId, ownerId, unitId });
    if (!source) throw new NotFoundException("Course source not found");
    return source;
  }
  @Post('units/:unitId/teaching/ensure')
  async ensureTeaching(@CurrentUserId() ownerId: string, @Param('unitId') unitId: string, @Body() body?: unknown) {
    if (!this.context.teaching) throw new BadRequestException('Course teaching preparation is unavailable');
    if (body != null && (typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key => key !== 'reuse')))
      throw new BadRequestException('Teaching preparation only fills missing content');
    const reuse = (body as {reuse?: unknown} | undefined)?.reuse;
    if (reuse !== undefined) {
      const parsed = courseTeachingReuseSchema.safeParse(reuse);
      if (!parsed.success) throw new BadRequestException('Invalid accepted teaching content');
      return this.context.teaching.ensure(ownerId, unitId, parsed.data);
    }
    return this.context.teaching.ensure(ownerId, unitId);
  }
  @Get('units/:unitId/teaching')
  async teachingDraft(@CurrentUserId() ownerId: string, @Param('unitId') unitId: string) {
    if (!this.context.teaching) throw new NotFoundException('Course teaching preparation is unavailable');
    return this.context.teaching.read(ownerId, unitId);
  }
  @Get("units/:unitId/assets/:resourceId")
  async asset(@CurrentUserId() ownerId: string, @Param("unitId") unitId: string,
    @Param("resourceId") resourceId: string, @Query("sha256") sha256: string, @Res() response: Response) {
    const asset = await this.context.repository.readAsset({ ownerId, unitId, resourceId, sha256 });
    if (!asset) throw new NotFoundException("Course asset not found");
    response.setHeader("Content-Type", asset.mediaType);
    response.setHeader("ETag", `"${sha256}"`);
    response.setHeader("Cache-Control", "private, no-store");
    response.send(Buffer.from(asset.data));
  }
}
