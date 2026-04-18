import { BaseEngine, ActorPush } from '../realm';

export declare class MemEngine extends BaseEngine {
  _messageGen: number;
  _inMsg: any[];
  _outMsg: any[];
  constructor();
  keepMemHistory(msgStore: any[], actor: ActorPush): void;
  saveInboundHistory(actor: ActorPush): void;
  saveChangeHistory(actor: ActorPush): void;
  getHistoryAfter(after: any, uri: string, cbRow: (cmd: any) => void): Promise<void>;
  getMemoryMessagesCount(): number;
}
