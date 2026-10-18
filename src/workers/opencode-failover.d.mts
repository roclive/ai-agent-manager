export function retryable(output: string): boolean;
export function failover<T>(
  backends: T[],
  run: (backend: T) => Promise<{ status: number; output: string }>,
  report?: (from: T, to: T) => void,
): Promise<{ status: number; output: string }>;
