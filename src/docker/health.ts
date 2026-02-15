export async function waitForHealthy(
  url: string,
  timeoutMs: number,
  intervalMs = 2000,
): Promise<boolean> {
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return true;
      }
    } catch {
      // Connection refused or other error — retry
    }

    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  return false;
}
