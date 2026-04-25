import { HyperClient } from './client';
import { BaseRealm } from '../realm';

export declare class MemServer {
  constructor(gate: any);
  requestFlush(): void;
  processStreams(): void;
  addSender(pipe: any): void;
  createClient(realm: BaseRealm): HyperClient & { session: () => any };
}

export declare function SessionMemListener(memServer: MemServer, transport: any): void;
export declare function RealmAdapter(memServer: MemServer, gate: any, session: any): void;
