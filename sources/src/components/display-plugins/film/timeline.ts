/** Canonical display clock input. Hosts adapt narration to this portable shape. */
export type DisplayCaptionInterval = Readonly<{kind: string; beatId?: string; startTick: number; durationTicks: number}>;
export type CompiledVideoTimelineV1 = Readonly<{durationTicks: number; scenes: readonly Readonly<{id: string; startTick: number; endTick: number}>[]; tracks: readonly DisplayCaptionInterval[]}>;
export type CaptionTrack = DisplayCaptionInterval & {kind:'caption';beatId:string};
