export function sidecarUtilityProcessForkOptions(
  platform: NodeJS.Platform = process.platform,
): {
  serviceName: string;
  stdio: "pipe";
  allowLoadingUnsignedLibraries?: boolean;
} {
  return {
    serviceName: "XueLearn Local Service",
    stdio: "pipe",
    // The sidecar loads native SQLite, vector and image modules. macOS
    // library validation can SIGKILL the default Helper for external binaries
    // when it loads them (exit code 9). Helper (Plugin) is the supported
    // exception for that native sidecar.
    ...(platform === "darwin"
      ? { allowLoadingUnsignedLibraries: true }
      : {}),
  };
}

export function shouldLogSidecarOutput(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return (
    env.XUELEARN_DESKTOP_E2E_LOG_SIDECAR === "1" ||
    env.XUELEARN_DESKTOP_DEV === "1"
  );
}
