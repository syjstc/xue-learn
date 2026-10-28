import { Body, Controller, Get, Patch, UseGuards } from "@nestjs/common";
import { RequireAuthGuard } from "../../../../common/src/index.js";
import { SettingsService } from "./settings.service.js";

@Controller("api/settings")
@UseGuards(RequireAuthGuard)
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  @Get("llm")
  getLlm() {
    return this.settings.getLlm();
  }

  @Patch("llm")
  patchLlm(@Body() body: unknown) {
    return this.settings.patchLlm(body);
  }

  @Get("search")
  getSearch() {
    return this.settings.getSearch();
  }

  @Patch("search")
  patchSearch(@Body() body: unknown) {
    return this.settings.patchSearch(body);
  }

  @Get("images")
  getImages() {
    return this.settings.getImages();
  }

  @Patch("images")
  patchImages(@Body() body: unknown) {
    return this.settings.patchImages(body);
  }

  @Get("learning-view")
  getLearningView() {
    return this.settings.getLearningView();
  }

  @Patch("learning-view")
  patchLearningView(@Body() body: unknown) {
    return this.settings.patchLearningView(body);
  }

  @Get("appearance")
  getAppearance() {
    return this.settings.getAppearance();
  }

  @Patch("appearance")
  patchAppearance(@Body() body: unknown) {
    return this.settings.patchAppearance(body);
  }

  @Get("client-preferences")
  getClientPreferences() {
    return this.settings.getClientPreferences();
  }

  @Patch("client-preferences")
  patchClientPreferences(@Body() body: unknown) {
    return this.settings.patchClientPreferences(body);
  }

  @Get("memory")
  getMemory() {
    return this.settings.getMemory();
  }

  @Patch("memory")
  patchMemory(@Body() body: unknown) {
    return this.settings.patchMemory(body);
  }
}
