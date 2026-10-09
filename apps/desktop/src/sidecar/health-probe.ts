export async function probeLoopbackHealth(
  session: { baseUrl: string; token: string },
  timeoutMs = 10_000,
): Promise<void> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${session.baseUrl}/api/local/health`, {
      headers: { Authorization: `Bearer ${session.token}` },
      redirect: "error",
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`Local service health check failed (${response.status})`);
  } finally {
    clearTimeout(timeout);
  }
}
