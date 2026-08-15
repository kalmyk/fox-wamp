'use strict';

import { match, defaultParse } from '../topic_pattern';
import { errorCodes } from '../realm_error';
import { KeyValueStorageAbstract, ActorPushKv, isDataFit, isDataEmpty, deepDataMerge, IActorPush } from '../realm';

export class MemKeyValueStorage extends KeyValueStorageAbstract {
  public _keyDb: Map<string, any>;

  constructor() {
    super();
    this._keyDb = new Map();
  }

  getKey(uri: string[], cbRow: (aKey: string[], data: any, eventId: any) => void): Promise<void> {
    return new Promise((resolve) => {
      for (const [key, item] of this._keyDb) {
        const aKey = defaultParse(key);
        if (match(aKey, uri)) {
          cbRow(aKey, item[1] /* data */, item[4] /* eventId */);
        }
      }
      resolve();
    });
  }

  setKeyActor(actor: IActorPush): Promise<void> {
    const suri = this.getStrUri(actor);

    // let oldSid
    // let oldWill
    let oldData: any = null;
    let resWhen: any[] = [];

    const findNextWhenActor = (curData: any) => {
      for (let i = 0; i < resWhen.length; i++) {
        const whenActor = resWhen[i];
        if (!whenActor.isActive()) {
          resWhen.splice(i, 1);
          i--;
          continue;
        }
        if (isDataFit(whenActor.getOpt().when, curData)) {
          resWhen.splice(i, 1);
          return whenActor;
        }
      }
      return false;
    };

    const pubWhile = (newActor: any) => {
      do {
        const newOpt = newActor.getOpt();
        const newData = deepDataMerge(oldData, newActor.getData());
        const willSid = ('will' in newOpt) ? newActor.getSid() : null;
        newActor.confirm((actor as any).msg);
        if (isDataEmpty(newData)) {
          this._keyDb.delete(suri);
        } else {
          this._keyDb.set(suri, [willSid, newData, newOpt.will, resWhen, newActor.getEventId()]);
        }
        this.saveChangeHistory(new ActorPushKv(
          actor.getUri(),
          newData,
          { sid: newActor.getSid(), retained: true, delta: true, trace: true }
        ));
        newActor = findNextWhenActor(newData);
      } while (newActor);
    };

    const opt = actor.getOpt();
    const oldRow = this._keyDb.get(suri);
    if (oldRow) {
      [, oldData, , resWhen] = oldRow;
    }

    if ('when' in opt) {
      if (isDataFit(opt.when, oldData)) {
        pubWhile(actor);
        return Promise.resolve();
      } else if (opt.watch) {
        resWhen.push(actor);
        return Promise.resolve();
      } else {
        actor.rejectCmd(String(errorCodes.ERROR_INVALID_PAYLOAD), 'not accepted');
        return Promise.resolve();
      }
    }
    // no when publish
    pubWhile(actor);
    return Promise.resolve();
  }

  eraseSessionData(sessionId: string): Promise<void> {
    const toRemove: string[] = [];
    for (const [key, value] of this._keyDb) {
      const resWhen = value[3];
      for (let i = resWhen.length - 1; i >= 0; i--) {
        const whenActor = resWhen[i];
        if (whenActor.getSid() === sessionId) {
          resWhen.splice(i, 1);
        }
      }

      const keySessionId = value[0];
      if (keySessionId === sessionId) {
        toRemove.push(key);
      }
    }
    for (let i = 0; i < toRemove.length; i++) {
      const key = toRemove[i];
      const row = this._keyDb.get(key);
      const will = row[2];
      if (will) {
        this.runInboundEvent(sessionId, defaultParse(key) as any, will);
      } else {
        this.runInboundEvent(sessionId, defaultParse(key) as any, null);
      }
    }
    return Promise.resolve();
  }
}
