export type MaterialFollowUpRecord = Readonly<{ id: string; unitId: string; anchor: string; messages: string; createdAt: Date; updatedAt: Date }>;
export type MaterialFollowUpUnitContext = Readonly<{ unitId: string; unitTitle: string; status: string; goalId: string; goalTitle: string; userId: string; contentLanguage: string; topicCategory: string; contentRevision: number }>;
export interface MaterialFollowUpRepository {
  listForUnit(userId: string, unitId: string): Promise<MaterialFollowUpRecord[] | null>;
  listRecent(userId: string, limit: number): Promise<Array<MaterialFollowUpRecord & { unitTitle: string; goalId: string; goalTitle: string }>>;
  findUnitContext(userId: string, unitId: string): Promise<MaterialFollowUpUnitContext | null>;
  findThread(userId: string, unitId: string, threadId: string): Promise<MaterialFollowUpRecord | null>;
  saveConversation(input: Readonly<{ userId: string; unitId: string; threadId?: string; threadStateJson: string; anchor: string; messages: string; userMessage: string; userMetadata?: string; userMessageCreatedAt: string; assistantMessage: string; assistantMessageCreatedAt: string; assistantToolCalls: string; assistantUiPayload: string; assistantMetadata: string }>): Promise<string | null>;
  delete(userId: string, unitId: string, threadId: string): Promise<boolean>;
}
