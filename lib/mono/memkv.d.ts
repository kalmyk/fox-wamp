import { KeyValueStorageAbstract, ActorPush } from '../realm';

export declare class MemKeyValueStorage extends KeyValueStorageAbstract {
  _keyDb: Map<string, any>;
  constructor();
  getKey(uri: string[], cbRow: (aKey: string[], data: any, eventId: any) => void): Promise<void>;
  setKeyActor(actor: ActorPush): Promise<void>;
  eraseSessionData(sessionId: string): Promise<void>;
}
