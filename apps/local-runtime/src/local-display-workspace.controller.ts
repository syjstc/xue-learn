import {BadRequestException, Body, Controller, Get, Inject, NotFoundException, Param, Post} from "@nestjs/common";
import {CurrentUserId} from "@xue-learn/core/common";
import type {DisplayWorkspaceService} from "@xue-learn/core/server/display-workspace";

export const LOCAL_DISPLAY_WORKSPACE = "LOCAL_DISPLAY_WORKSPACE";

/** Local ingress supplies the authenticated workspace owner for every build request. */
@Controller("api/local")
export class LocalDisplayWorkspaceController {
  constructor(@Inject(LOCAL_DISPLAY_WORKSPACE) private readonly workspace: DisplayWorkspaceService) {}
  @Get("display-plugins")
  list() {return this.workspace.plugins.list();}
  @Post("display-plugins/import")
  async install(@Body() value: unknown) {
    try {return await this.workspace.plugins.install(value);}
    catch (error) {throw new BadRequestException(error instanceof Error ? error.message : String(error));}
  }
  @Post("display-plugins/enabled")
  async enable(@Body() value: {id?: unknown; version?: unknown; enabled?: unknown}) {
    if (typeof value?.id !== "string" || typeof value.version !== "string" || typeof value.enabled !== "boolean") throw new BadRequestException("Invalid display plugin selection");
    try {return await this.workspace.plugins.setEnabled(value.id, value.version, value.enabled);}
    catch (error) {throw new BadRequestException(error instanceof Error ? error.message : String(error));}
  }
  @Post("display-builds/resolve")
  async resolve(@CurrentUserId() owner: string, @Body() value: {document?: unknown}) {
    try {return await this.workspace.resolveDocument(owner, value?.document);}
    catch (error) {throw new BadRequestException(error instanceof Error ? error.message : String(error));}
  }
  @Get("display-builds/:id")
  async get(@CurrentUserId() owner: string, @Param("id") id: string) {
    const value = await this.workspace.getJob(owner, id);
    if (!value) throw new NotFoundException("Display build not found");
    return value;
  }
  @Post("display-builds/:id/retry")
  async retry(@CurrentUserId() owner: string, @Param("id") id: string) {
    if (!await this.workspace.getJob(owner, id)) throw new NotFoundException("Display build not found");
    await this.workspace.builds.retry(id, owner);
    return this.workspace.getJob(owner, id);
  }
  @Post("display-builds/:id/cancel")
  async cancel(@CurrentUserId() owner: string, @Param("id") id: string) {
    if (!await this.workspace.getJob(owner, id)) throw new NotFoundException("Display build not found");
    await this.workspace.builds.cancel(id, owner);
    return this.workspace.getJob(owner, id);
  }
}
