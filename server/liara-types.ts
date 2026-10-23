export type LiaraApp = { id: string; projectId?:string|null; platform: string | null; status: string | null; scale: number | null; deployed: boolean | null; createdAt: string | null };
export type LiaraStatus = { scope?:import('./liara-scope.js').AccountScope; configured: boolean; state: 'unconfigured' | 'disconnected' | 'connected' | 'auth_required' | 'error'; account: { id: string; name: string | null } | null; selectedApp: string | null; verifiedAt: string | null; error: { code: string; message: string } | null };
export type Evidence<T> = { source: 'liara-api'; endpoint: string; fetchedAt: string; data: T };
export type ReadResult<T> = { state: 'ok'; evidence: Evidence<T> } | { state: 'error' | 'unsupported'; code: string; message: string; endpoint: string; fetchedAt: string };
export type LogEntry = { timestamp: string; level: string; message: string; releaseId?:string };
// Raw tuple columns only: upstream does not establish timestamp/value units.
export type MetricSeries = { instance: string; points: { x: number; value: number | null }[] };
export type Release = { id: string; tag: string | null; state: string | null; createdAt: string | null; isCurrent?:boolean|null };
export type LiaraSnapshot = {
  id: string; appId: string; fetchedAt: string; window: { from: string; to: string };
  details: ReadResult<LiaraApp>; logs: ReadResult<LogEntry[]>;
  cpu: ReadResult<MetricSeries[]>; memory: ReadResult<MetricSeries[]>; releases: ReadResult<Release[]>;
};
