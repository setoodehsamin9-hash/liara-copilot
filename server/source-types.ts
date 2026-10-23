export type AppScope = { accountId: string; appId: string };
export type SourceCandidate = { id: string; label: string };
export type SourceAssociation = { kind: 'local' | 'github'; label: string; revision: string | null; branch: string | null; fetchedAt: string; access: 'metadata-only' };
