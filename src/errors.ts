/** Invalid arguments or inputs. Exit code 2. */
export class UsageError extends Error {
  override name = 'UsageError';
}

/** No probe could start or reach the server. Exit code 3. */
export class UnreachableError extends Error {
  override name = 'UnreachableError';
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
