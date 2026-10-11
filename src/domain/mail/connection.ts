import type { ID } from './types';

export type ConnectionStatus = {
  state: 'idle' | 'connecting' | 'syncing' | 'reauth' | 'error';
  message?: string;
  lastSyncedAt?: number;
};

/** Optional account lifecycle for providers that require user sign-in. */
export interface MailConnection {
  getStatus(): ConnectionStatus;
  subscribeStatus(listener: () => void): () => void;
  connect(): Promise<void>;
  cancelConnect(): Promise<void>;
  disconnect(accountId: ID): Promise<void>;
  resetLocalChanges(accountId: ID): Promise<void>;
  refresh(): Promise<void>;
}
