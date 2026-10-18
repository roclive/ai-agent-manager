export interface UsageSnapshot {
  id: number;
  provider: string;
  type: 'cost' | 'quota';
  window: string;
  used: number | 'unknown';
  remaining: number | 'unknown';
  reset_at: string | null;
  source: string;
  freshness: string;
  raw_data: string;
  created_at: string;
}
