import { BadRequestException, ConflictException, NotFoundException } from "@nestjs/common";
import { tBackend } from "../../../common/src/index.js";
import type { ScenarioTheaterRunRecord, ScenarioTheaterSessionRecord, ScenarioTheaterSessionRepository } from "../../../domain/src/index.js";
import { type ScenarioTheaterDefinition, type ScenarioTheaterPathEntry } from "./schema.js";
import { materializeScenarioTheaterDefinitionFromScenes } from "./generation.js";
import { resolveTeachingPersona } from "../teaching-personas/index.js";

async function withCurrentCoach(definition: ScenarioTheaterDefinition, userId: string, goalId: string): Promise<ScenarioTheaterDefinition> {
  const coach = await resolveTeachingPersona(userId, goalId);
  return { ...definition, coach: { name: coach.name, avatarCode: coach.avatarCode } };
}

function initialMeters(definition: ScenarioTheaterDefinition) {
  return Object.fromEntries(definition.meters.map((meter) => [meter.id, meter.initial]));
}

function runPayload(run: ScenarioTheaterRunRecord | null) {
  if (!run) return null;
  return { id: run.id, theaterRevision: run.theaterRevision, runVersion: run.runVersion, status: run.status, currentSceneId: run.currentSceneId, meters: run.metersJson && typeof run.metersJson === "object" ? run.metersJson : {}, path: Array.isArray(run.pathJson) ? run.pathJson : [], endingId: run.endingId, startedAt: run.startedAt.toISOString(), completedAt: run.completedAt?.toISOString() ?? null };
}

function currentSceneStatus(record: ScenarioTheaterSessionRecord, sceneId: string | null) {
  if (!sceneId) return null;
  return record.scenes.find((scene) => scene.sceneId === sceneId)?.status ?? "ready";
}

function requirePlayable(record: ScenarioTheaterSessionRecord) {
  const theater = record.theater;
  if (!theater || !["prepared", "ready"].includes(theater.status) || !theater.definitionJson) {
    throw new ConflictException(tBackend("error.scenario.notReady"));
  }
  return { theater, definition: materializeScenarioTheaterDefinitionFromScenes(theater, record.scenes.filter((scene) => scene.status === "ready")) };
}

async function requireOwned(repository: ScenarioTheaterSessionRepository, userId: string, unitId: string) {
  const record = await repository.load({ userId, unitId });
  if (!record) throw new NotFoundException(tBackend("error.notFound"));
  return record;
}

export async function getScenarioTheaterContent(repository: ScenarioTheaterSessionRepository, userId: string, unitId: string) {
  const record = await requireOwned(repository, userId, unitId);
  const theater = record.theater;
  return theater ? { status: theater.status, recommended: theater.recommended, recommendation: theater.recommendation, revision: theater.revision, definition: ["prepared", "ready"].includes(theater.status) && theater.definitionJson ? await withCurrentCoach(materializeScenarioTheaterDefinitionFromScenes(theater, record.scenes.filter((scene) => scene.status === "ready")), userId, record.goalId) : null, generationError: theater.status === "failed" ? theater.generationError : "" } : null;
}

export async function getScenarioTheaterSession(repository: ScenarioTheaterSessionRepository, userId: string, unitId: string) {
  const record = await requireOwned(repository, userId, unitId);
  const theater = record.theater;
  if (!theater) return { available: false, completedOnce: false, activeRun: null };
  return { available: ["prepared", "ready"].includes(theater.status), status: theater.status, revision: theater.revision, completedOnce: record.completedOnce, activeRun: runPayload(record.activeRun), currentSceneStatus: currentSceneStatus(record, record.activeRun?.currentSceneId ?? null) };
}

export async function startScenarioTheater(repository: ScenarioTheaterSessionRepository, userId: string, unitId: string) {
  const record = await requireOwned(repository, userId, unitId);
  const { theater, definition: storedDefinition } = requirePlayable(record);
  const definition = await withCurrentCoach(storedDefinition, userId, record.goalId);
  const run = await repository.createOrReuse({ userId, unitId, theaterId: theater.id, theaterRevision: theater.revision, initialSceneId: definition.initialSceneId, metersJson: initialMeters(definition) });
  return { definition, run: runPayload(run), currentSceneStatus: currentSceneStatus(record, run.currentSceneId), completedOnce: record.completedOnce };
}

export async function chooseScenarioTheaterOption(repository: ScenarioTheaterSessionRepository, userId: string, unitId: string, payload: Record<string, unknown>) {
  const runId = String(payload.runId ?? ""), sceneId = String(payload.sceneId ?? ""), choiceId = String(payload.choiceId ?? ""), runVersion = Number(payload.runVersion);
  if (!runId || !sceneId || !choiceId || !Number.isInteger(runVersion)) throw new BadRequestException(tBackend("error.scenario.invalidChoicePayload"));
  const record = await requireOwned(repository, userId, unitId);
  const { theater, definition: storedDefinition } = requirePlayable(record);
  const run = await repository.findRun({ userId, unitId, runId });
  if (!run) throw new NotFoundException(tBackend("error.scenario.runNotFound"));
  if (run.status !== "active" || run.runVersion !== runVersion || run.currentSceneId !== sceneId || run.theaterRevision !== theater.revision) throw new ConflictException(tBackend("error.scenario.stateUpdated"));
  const definition = await withCurrentCoach(storedDefinition, userId, record.goalId);
  const scene = definition.scenes.find((item) => item.id === sceneId);
  const choice = scene?.choices.find((item) => item.id === choiceId);
  if (!scene || !choice) throw new BadRequestException(tBackend("error.scenario.choiceNotFound"));
  const meters = { ...initialMeters(definition), ...(run.metersJson && typeof run.metersJson === "object" ? run.metersJson as Record<string, number> : {}) };
  for (const effect of choice.effects) { const meter = definition.meters.find((item) => item.id === effect.meterId); if (meter) meters[meter.id] = Math.max(meter.min, Math.min(meter.max, (meters[meter.id] ?? meter.initial) + effect.delta)); }
  const path = Array.isArray(run.pathJson) ? run.pathJson as ScenarioTheaterPathEntry[] : [];
  const nextPath: ScenarioTheaterPathEntry[] = [...path, { sceneId, choiceId, consequence: choice.consequence, reflection: choice.reflection, effects: choice.effects, chosenAt: new Date().toISOString() }];
  const completed = Boolean(choice.endingId);
  const outcome = await repository.commitChoice({ userId, unitId, runId, theaterId: theater.id, theaterRevision: theater.revision, runVersion, sceneId, currentSceneId: completed ? null : choice.nextSceneId ?? null, metersJson: meters, pathJson: nextPath, endingId: choice.endingId ?? null, completed });
  if (outcome === "missing") throw new NotFoundException(tBackend("error.scenario.runNotFound"));
  if (outcome !== "saved") throw new ConflictException(tBackend("error.scenario.stateUpdated"));
  const saved = await repository.findRun({ userId, unitId, runId });
  return { definition, run: runPayload(saved), currentSceneStatus: currentSceneStatus(record, saved?.currentSceneId ?? null), consequence: choice.consequence, reflection: choice.reflection, effects: choice.effects, ending: choice.endingId ? definition.endings.find((ending) => ending.id === choice.endingId) ?? null : null };
}

export async function restartScenarioTheater(repository: ScenarioTheaterSessionRepository, userId: string, unitId: string) {
  const record = await requireOwned(repository, userId, unitId);
  const { theater, definition: storedDefinition } = requirePlayable(record);
  const definition = await withCurrentCoach(storedDefinition, userId, record.goalId);
  const restarted = await repository.restart({ userId, unitId, theaterId: theater.id, theaterRevision: theater.revision, initialSceneId: definition.initialSceneId, metersJson: initialMeters(definition) });
  return { definition, run: runPayload(restarted.run), currentSceneStatus: currentSceneStatus(record, restarted.run.currentSceneId), completedOnce: restarted.completedOnce };
}

export async function scenarioTheaterCompletionRequired(repository: ScenarioTheaterSessionRepository, userId: string, unitId: string): Promise<boolean> {
  const record = await requireOwned(repository, userId, unitId);
  return Boolean(record.theater && ["prepared", "ready"].includes(record.theater.status) && !record.completedOnce);
}
