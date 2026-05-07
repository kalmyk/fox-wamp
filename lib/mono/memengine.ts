'use strict';

import { match } from '../topic_pattern';
import { BaseEngine, ActorPush } from '../realm';

/* store event history in memory */

export class MemEngine extends BaseEngine {
  public _messageGen: number;
  public _inMsg: any[];
  public _outMsg: any[];

  constructor() {
    super();
    this._messageGen = 0;
    this._inMsg = [];
    this._outMsg = [];
  }

  keepMemHistory(msgStore: any[], actor: ActorPush): void {
    actor.setEventId(String(++this._messageGen));
    if (actor.getOpt().trace) {
      msgStore.push(actor.getEvent());
      if (msgStore.length > 10100) {
        msgStore.splice(0, 100);
      }
    }
  }

  saveInboundHistory(actor: ActorPush): void {
    this.keepMemHistory(this._inMsg, actor);
  }

  saveChangeHistory(actor: ActorPush): void {
    this.keepMemHistory(this._outMsg, actor);
  }

  getHistoryAfter(after: any, uri: string[], cbRow: (cmd: any) => void): Promise<void> {
    return new Promise((resolve) => {
      for (let i = 0; i < this._inMsg.length; i++) {
        const event = this._inMsg[i];
        if (event.qid > after && match(event.uri, uri)) {
          cbRow(event);
        }
      }
      resolve();
    });
  }

  getMemoryMessagesCount(): number {
    return this._inMsg.length;
  }
}
