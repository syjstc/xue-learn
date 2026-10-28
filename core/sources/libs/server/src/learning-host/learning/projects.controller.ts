import { Body, Controller, Get, HttpCode, Param, Post, Query, UseGuards } from "@nestjs/common";
import { CurrentUserId } from "../../../../common/src/index.js";
import { ProjectsService } from "./projects.service.js";
@Controller("api")
export class ProjectsController {
    constructor(private readonly projects: ProjectsService) { }
    @Get("goals/:goalId/projects")
    listProjects(
    @CurrentUserId()
    userId: string, 
    @Param("goalId")
    goalId: string) {
        return this.projects.listProjects(userId, goalId);
    }
    @Get("projects/:projectId")
    getProject(
    @CurrentUserId()
    userId: string, 
    @Param("projectId")
    projectId: string) {
        return this.projects.getProject(userId, projectId);
    }
    @Post("projects/:projectId/milestones/:milestoneId/attempts")
    submitMilestoneAttempt(
    @CurrentUserId()
    userId: string, 
    @Param("projectId")
    projectId: string, 
    @Param("milestoneId")
    milestoneId: string, 
    @Body()
    body: unknown) {
        return this.projects.submitMilestoneAttempt(userId, projectId, milestoneId, body);
    }
}
