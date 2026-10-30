import { BadRequestException, Body, Controller, Get, Inject, NotFoundException, Param, Post, Query, Res } from "@nestjs/common";
import type { Response } from "express";
import { CurrentUserId } from "@xue-learn/core/common";
import { z } from "zod";
import type { ReadingWorkspaceService } from "@xue-learn/core/server/reading";
import { prepareReadingHtml } from "@xue-learn/core/server/reading";

export const LOCAL_READING_WORKSPACE = "LOCAL_READING_WORKSPACE";
const generateSchema = z.object({regenerate: z.boolean().optional()}).strict();
const controlSchema = z.object({
  jobId: z.string().regex(/^[a-f0-9]{64}$/),
  action: z.enum(["retry", "cancel"]), componentId: z.string().regex(/^b[0-9]+$/).optional(),
}).strict();

@Controller("api/units/:unitId/reading")
export class LocalReadingController {
  constructor(@Inject(LOCAL_READING_WORKSPACE) private readonly reading: ReadingWorkspaceService) {}
  @Get()
  async read(@CurrentUserId() owner: string, @Param("unitId") unit: string) {
    const course = await this.reading.read(owner, unit);
    if (!course) throw new NotFoundException("阅读课程不存在。");
    return course;
  }
  @Get("events")
  async events(@CurrentUserId() owner: string, @Param("unitId") unit: string, @Res() response: Response) {
    if (!await this.reading.read(owner, unit)) throw new NotFoundException("阅读课程不存在。");
    response.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    response.setHeader("Cache-Control", "private, no-cache, no-transform");
    response.setHeader("X-Accel-Buffering", "no");
    response.flushHeaders();
    let closed = false, publishing = false, dirty = true;
    let scheduled: ReturnType<typeof setTimeout> | undefined;
    let keepAlive: ReturnType<typeof setInterval> | undefined;
    let unsubscribe = () => {};
    const dispose = () => {
      if (closed) return;
      closed = true;
      clearTimeout(scheduled);
      clearInterval(keepAlive);
      unsubscribe();
    };
    const publish = async () => {
      scheduled = undefined;
      if (closed || publishing) return;
      publishing = true;
      try {
        while (dirty && !closed) {
          dirty = false;
          const course = await this.reading.read(owner, unit);
          if (closed) return;
          if (!course) { dispose(); response.end(); return; }
          response.write(`data: ${JSON.stringify(course)}\n\n`);
          const active = course.sections.some(section =>
            section.reading?.status === "pending" || section.reading?.status === "running" ||
            (section.reading?.pendingComponents ?? 0) > 0);
          if (!active) { dispose(); response.end(); return; }
        }
      } catch {
        dispose();
        response.end();
      } finally { publishing = false; }
    };
    unsubscribe = this.reading.subscribe(owner, unit, () => {
      dirty = true;
      if (!publishing && !scheduled) scheduled = setTimeout(() => void publish(), 25);
    });
    response.once("close", dispose);
    keepAlive = setInterval(() => response.write(": keep-alive\n\n"), 15_000);
    keepAlive.unref?.();
    await publish();
  }
  @Get("sections/:sectionId/print")
  async print(@CurrentUserId() owner: string, @Param("unitId") unit: string,
    @Param("sectionId") section: string, @Query("layout") layout: string, @Res() response: Response) {
    if (layout && layout !== "mobile" && layout !== "desktop") throw new BadRequestException("PDF 版式无效。");
    const course = await this.reading.read(owner, unit);
    const document = course?.sections.find(item => item.id === section)?.reading?.document;
    if (!document) throw new NotFoundException("尚无可导出的阅读内容。");
    const html = await prepareReadingHtml(unit, document, {layout: layout === "desktop" ? "desktop" : "mobile", language: course!.language});
    response.setHeader("Content-Type", "text/html; charset=utf-8");
    response.setHeader("Cache-Control", "private, no-store");
    response.setHeader("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:");
    response.send(html);
  }
  @Post("sections/:sectionId/generate")
  async generate(@CurrentUserId() owner: string, @Param("unitId") unit: string,
    @Param("sectionId") section: string, @Body() body?: unknown) {
    const parsed = generateSchema.safeParse(body ?? {});
    if (!parsed.success) throw new BadRequestException("阅读生成参数无效。");
    try { return await this.reading.generate(owner, unit, section, parsed.data.regenerate); }
    catch (error) { throw new BadRequestException(error instanceof Error ? error.message : String(error)); }
  }
  @Post("sections/:sectionId/jobs")
  async control(@CurrentUserId() owner: string, @Param("unitId") unit: string,
    @Param("sectionId") section: string, @Body() body: unknown) {
    const parsed = controlSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException("阅读任务参数无效。");
    try { return await this.reading.control(owner, unit, section, parsed.data); }
    catch (error) { throw new BadRequestException(error instanceof Error ? error.message : String(error)); }
  }
}
