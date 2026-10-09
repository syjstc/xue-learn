import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { CurrentUserId, RequireAuthGuard } from "../../../../common/src/index.js";
import { AgendaService } from "./agenda.service.js";
@Controller()
@UseGuards(RequireAuthGuard)
export class AgendaController {
    constructor(private readonly service: AgendaService) { }
    @Get("api/agenda")
    getAgenda(
    @CurrentUserId()
    userId: string, 
    @Query("goalId")
    goalId?: string, 
    @Query("spaceId")
    spaceId?: string) {
        return this.service.getAgenda(userId, goalId, spaceId);
    }
    @Get("api/agenda/settings")
    getSettings(
    @CurrentUserId()
    userId: string) {
        return this.service.getSettings(userId);
    }
    @Patch("api/agenda/settings")
    patchSettings(
    @CurrentUserId()
    userId: string, 
    @Body()
    body: unknown) {
        return this.service.patchSettings(userId, body);
    }
    @Patch("api/agenda/today-capacity")
    patchTodayCapacity(
    @CurrentUserId()
    userId: string, 
    @Body()
    body: unknown) {
        return this.service.patchTodayCapacity(userId, body);
    }
    @Post("api/agenda/refresh")
    refresh(
    @CurrentUserId()
    userId: string, 
    @Body()
    body: unknown) {
        return this.service.refresh(userId, body);
    }
    @Get("api/agenda/items/:id/explanation")
    getItemExplanation(
    @CurrentUserId()
    userId: string, 
    @Param("id")
    id: string) {
        return this.service.getItemExplanation(userId, id);
    }
}
