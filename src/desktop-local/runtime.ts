import {
  DESKTOP_BRIDGE_VERSION,
  runtimeDescriptorSchema,
  type RuntimeDescriptor,
  type XueLearnDesktopBridge,
} from "@xue-learn/core/runtime-contracts";

declare global {
  interface Window {
    xueLearnDesktop?: XueLearnDesktopBridge;
  }
}

let runtimePromise: Promise<RuntimeDescriptor> | undefined;

export function getDesktopBridge(): XueLearnDesktopBridge {
  const bridge = window.xueLearnDesktop;
  if (!bridge || bridge.version !== DESKTOP_BRIDGE_VERSION) {
    throw new Error("The XueLearn desktop bridge is unavailable or incompatible");
  }
  return bridge;
}

export function bootstrapDesktopRuntime(): Promise<RuntimeDescriptor> {
  const pending = runtimePromise ?? getDesktopBridge()
    .runtime.getDescriptor()
    .then((value) => runtimeDescriptorSchema.parse(value))
    .then((runtime) => {
      if (runtime.kind !== "desktop-local") {
        throw new Error(`Expected desktop-local runtime, received ${runtime.kind}`);
      }
      return runtime;
    });
  runtimePromise = pending;
  return pending;
}
