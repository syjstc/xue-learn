import { z } from "zod";

export const nativeEffects = [
  "filesystem.read",
  "filesystem.write",
  "process.spawn",
  "network",
  "external.mutation",
] as const;
export const nativeEffectSchema = z.enum(nativeEffects);
export type NativeEffect = z.infer<typeof nativeEffectSchema>;

export const nativeToolDescriptorSchema = z.object({
  id: z.string().min(1),
  version: z.number().int().positive(),
  effects: z.array(nativeEffectSchema),
  approval: z.enum(["none", "first-use", "every-use"]),
});
export type NativeToolDescriptor = z.infer<typeof nativeToolDescriptorSchema>;
