import type { Account, ID } from './types';

export type ConnectionStatus = {
  state: 'idle' | 'connecting' | 'syncing' | 'reauth' | 'error';
  message?: string;
  lastSyncedAt?: number;
  retryAt?: number;
};

export type MailActivityAction = 'refresh' | 'reset' | 'connect' | 'disconnect' | 'cancelConnect';
export type MailActivitySnapshot = {
  account?: Account;
  status: ConnectionStatus;
  busy: boolean;
  message?: string;
};

/** Shares the owning connection with an auxiliary activity window. */
export interface MailActivity {
  getSnapshot(): Promise<MailActivitySnapshot>;
  publish(snapshot: MailActivitySnapshot): Promise<void>;
  subscribeActions(handler: (action: MailActivityAction) => Promise<void>): () => void;
  perform(action: MailActivityAction): Promise<void>;
}

export type MailDiagnosticEntry = {
  timestamp: number;
  operation: string;
  outcome: string;
  status: number | null;
  durationMs: number;
  waitMs: number;
  quotaUnits: number;
  reason: string | null;
  retryAfter: number | null;
  count: number | null;
};

export type MailDiagnostics = {
  entries: MailDiagnosticEntry[];
  requests: number;
  quotaUnits: number;
  rateLimits: number;
  cacheHits: number;
  retryAt?: number;
};

/** Optional account lifecycle for providers that require user sign-in. */
export interface MailConnection {
  readonly activity?: MailActivity;
  getStatus(): ConnectionStatus;
  subscribeStatus(listener: () => void): () => void;
  connect(): Promise<void>;
  cancelConnect(): Promise<void>;
  disconnect(accountId: ID): Promise<void>;
  resetLocalChanges(accountId: ID): Promise<void>;
  refresh(): Promise<void>;
  getDiagnostics?(): Promise<MailDiagnostics>;
}
