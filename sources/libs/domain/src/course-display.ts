/** Complete accepted display block, independent of any production projection. */
export type CourseDisplayBlock = Readonly<{type: string; [key: string]: unknown}>;

/** Shared board copy and slot layout; production hosts own timelines and source refs. */
export type CourseDisplayScene = Readonly<{templateId: string; slots: Readonly<Record<string, string>>; title: string}>;
