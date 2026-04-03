export async function retry<T>(fn: () => Promise<T>, times = 3, delayMs = 1000): Promise<T> {
  let lastError: Error | undefined;
  for (let i = 0; i < times; i++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err as Error;
      if (i < times - 1) await new Promise(r => setTimeout(r, delayMs * (i + 1)));
    }
  }
  throw lastError;
}
