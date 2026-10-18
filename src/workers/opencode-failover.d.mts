export function retryable(output: string): boolean;
export function failover(models: string[], run: (model: string) => Promise<{status: number; output: string}>, report?: (from: string, to: string) => void): Promise<{status: number; output: string}>;
