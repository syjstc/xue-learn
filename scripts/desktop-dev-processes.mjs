// Stop every service even if one process group has already exited or cannot be
// signalled (for example under a sandbox). Cleanup must not hide the build error.
export function terminateDevChildren(
  children,
  {
    platform = process.platform,
    killProcess = process.kill.bind(process),
    warn = (message) => process.stderr.write(`${message}\n`),
  } = {},
) {
  for (const child of children) {
    if (child.killed || !child.pid) continue;
    try {
      if (platform === "win32") {
        killProcess(child.pid, "SIGTERM");
      } else {
        try {
          killProcess(-child.pid, "SIGTERM");
        } catch (error) {
          if (error?.code !== "EPERM") throw error;
          // A denied group signal can still allow terminating our direct child.
          killProcess(child.pid, "SIGTERM");
        }
      }
    } catch (error) {
      if (error?.code === "ESRCH") continue;
      warn(
        `[shutdown] Could not stop child ${child.pid}: ${error?.code ?? error}. Check for remaining dev processes.`,
      );
    }
  }
}
