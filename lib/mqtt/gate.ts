'use strict';

import { SESSION_ALERT, SESSION_RX } from '../messages';
import { BaseGate, getBodyValue } from '../base_gate';
import { RealmError, errorCodes } from '../realm_error';
import { mqttParse, restoreMqttUri } from '../topic_pattern';
import { Context } from '../context';
import { Router } from '../router';
import { Session } from '../session';

const CONNACK_RETURN_ACCEPTED = 0;
// const CONNACK_RETURN_UNACCEPTABLE_PROTOCOL_VERSION = 1;
const CONNACK_RETURN_IDENTIFIER_REJECTED = 2;
// const CONNACK_RETURN_SERVER_UNAVAILABLE = 3;
const CONNACK_RETURN_BAD_USER_NAME_OR_PASSWORD = 4;
const CONNACK_RETURN_NOT_AUTHORIZED = 5;

export function toMqttPayload(body: any): Buffer {
  if (body === null) {
    return Buffer.alloc(0);
  }
  if (typeof body === 'object') {
    if ('payload' in body) {
      return body.payload;
    }
    if ('kv' in body) {
      return Buffer.from(JSON.stringify(body.kv));
    }
    if ('args' in body) {
      if (Array.isArray(body.args) && body.args.length === 1) {
        return Buffer.from(JSON.stringify(body.args[0]));
      }
      return Buffer.from(JSON.stringify(body.args));
    }
  }
  throw Error('unknown body type');
}

export function parseMqttPayload(payload: Buffer): { payload: Buffer } | null {
  return payload.length === 0 ? null : { payload: payload };
}

type Handler = (this: MqttGate, ctx: MqttSocketWriterContext, session: Session, message: any) => void;

const handlers: { [key: string]: Handler } = {};

export class MqttSocketWriterContext extends Context {
  public socketWriter: any;
  private mqttPkg: any;

  constructor(router: Router, session: Session, socketWriter: any) {
    super(router, session);
    this.socketWriter = socketWriter;
  }

  setSubscribePkg(mqttPkg: any): void {
    this.mqttPkg = mqttPkg;
  }

  getSubscribePkg(): any {
    return this.mqttPkg;
  }

  sendEvent(cmd: any): void {
    const session = this.getSession();
    if (session.getLastPublishedId() === cmd.qid) {
      return; // do not duplicate MQTT events on different subscriptions
    }
    const customId = this.getSession().genSessionMsgId();
    session.waitForId(cmd.qid, customId);
    session.setLastPublishedId(cmd.qid);

    this.mqttSend({
      topic: restoreMqttUri(cmd.uri),
      payload: toMqttPayload(cmd.data),
      qos: (cmd.opt.trace ? 1 : 0),
      messageId: customId,
      cmd: 'publish',
      retain: cmd.opt.retained === true
    });
  }

  sendPublished(cmd: any): void {
    this.mqttSend({ cmd: 'puback', messageId: cmd.id });
  }

  sendSubscribed(cmd: any): void {
    this.mqttSubscribeDone();
  }

  sendEndSubscribe(cmd: any): void {}

  mqttSend(msg: any, callback?: (err?: Error) => void): void {
    this.socketWriter.mqttPkgWrite(msg, callback);
  }

  mqttClose(code: number, reason: string): void {
    this.socketWriter.mqttPkgClose(code, reason);
  }

  sendError(cmd: any, code: string, text?: string): void {
    if (undefined === cmd.id) {
      throw new RealmError(undefined as any, code, text);
    } else {
      // subscribe error mode
      const pkg = this.getSubscribePkg();
      pkg.granted[cmd.id] = 0x80;
      this.mqttSubscribeDone();
    }
  }

  mqttSubscribeDone(): void {
    // granted is accepted QoS for the subscription, possible [0,1,2, + 128 or 0x80 for failure]
    const pkg = this.getSubscribePkg();
    pkg.count--;
    if (pkg.count === 0) {
      this.mqttSend({ cmd: 'suback', messageId: pkg.id, granted: pkg.granted });
    }
  }

  mqttConnack(returnCode: number, sessionPresent: boolean): void {
    this.mqttSend({ returnCode, sessionPresent, cmd: 'connack' });
  }
}

export class MqttGate extends BaseGate {
  createContext(session: Session, socketWriter: any): MqttSocketWriterContext {
    return new MqttSocketWriterContext(this.getRouter(), session, socketWriter);
  }

  checkRealm(session: Session, requestId?: any): void {
    if (!session.realm) {
      throw new RealmError(requestId, errorCodes.ERROR_NOT_AUTHORIZED);
    }
  }

  async joinRealm(ctx: MqttSocketWriterContext, session: Session, message: any): Promise<void> {
    const realm = await this.getRouter().getRealm(session.realmName!);
    realm.joinSession(session);
    if (message.will) {
      session.setDisconnectPublish(ctx, this.makePublishCmd(ctx, message.will));
    }
    if (session.secureDetails.clientId) {
      let found = false;
      realm.getKey(
        ['$FOX', 'clientOffset', session.secureDetails.clientId],
        (key: any, data: any) => {
          session.setLastPublishedId(getBodyValue(data));
          found = true;
        }
      ).then(() => {
        ctx.mqttConnack(CONNACK_RETURN_ACCEPTED, found);
      });
    } else {
      ctx.mqttConnack(CONNACK_RETURN_ACCEPTED, false);
    }
  }

  connect(ctx: MqttSocketWriterContext, session: Session, message: any): void {
    let result: RegExpMatchArray | null = null;
    if (typeof message.username === 'string') {
      result = message.username.match(/(.*)@([a-zA-Z0-9-]*)$/i);
    }
    session.secureDetails = {};
    if (result) {
      session.realmName = result[2];
      session.secureDetails.username = result[1];
    } else if (message.username) {
      ctx.mqttConnack(CONNACK_RETURN_BAD_USER_NAME_OR_PASSWORD, false);
      return;
    }
    if (message.clientId) {
      session.secureDetails.clientId = message.clientId;
      session.secureDetails.sessionClean = message.clean;
    }

    if (this.isAuthRequired(session)) {
      if (!session.realmName) {
        ctx.mqttConnack(CONNACK_RETURN_BAD_USER_NAME_OR_PASSWORD, false);
        return;
      }
      this._authHandler.auth(session.realmName, session.secureDetails, message.password, (err: any, userDetails: any) => {
        if (err) {
          ctx.mqttConnack(CONNACK_RETURN_NOT_AUTHORIZED, false);
        } else {
          session.setUserDetails(userDetails);
          this.joinRealm(ctx, session, message);
        }
      });
    } else {
      if (!session.realmName) {
        session.realmName = 'default_realm';
      }
      this.joinRealm(ctx, session, message);
    }
  }

  makePublishCmd(ctx: MqttSocketWriterContext, message: any): any {
    const opt: any = {};
    if (message.retain) {
      opt.retain = true;
    }
    if (message.qos >= 1) {
      opt.trace = true;
    }

    const cmd = {
      uri: mqttParse(message.topic),
      data: parseMqttPayload(message.payload),
      id: message.messageId,
      opt
    };
    if (this.checkAuthorize(ctx, cmd, 'publish')) {
      return cmd;
    }
    return false;
  }

  handle(ctx: MqttSocketWriterContext, session: Session, msg: any): void {
    this.getRouter().emit(SESSION_RX, session, msg);
    if (typeof msg !== 'object' || msg === null) {
      this.getRouter().emit(SESSION_ALERT, session, 'no object arrived', msg);
      ctx.mqttClose(1003, 'protocol violation');
      return;
    }
    if (!handlers[msg.cmd]) {
      this.getRouter().emit(SESSION_ALERT, session, 'command not found', msg);
      ctx.mqttClose(1003, 'protocol violation');
      return;
    }
    try {
      handlers[msg.cmd].call(this, ctx, session, msg);
    } catch (err) {
      if (err instanceof RealmError) {
        console.log(err);
        ctx.mqttClose(1003, err.message);
      } else {
        throw err;
      }
    }
  }
}

handlers.connect = function (ctx, session, message) {
  if (session.realm === null) {
    this.connect(ctx, session, message);
  } else {
    ctx.mqttConnack(CONNACK_RETURN_IDENTIFIER_REJECTED, false);
  }
};

handlers.disconnect = function (ctx, session, message) {
  // do not send WILL notification at correct disconnect
  session.cleanDisconnectPublish();
  ctx.mqttClose(1000, 'Server closed session');
};

handlers.publish = function (ctx, session, message) {
  this.checkRealm(session);
  // Error: Invalid publish topic 'com.myapp/#', does it contain '+' or '#'?

  const cmd = this.makePublishCmd(ctx, message);
  if (message.qos >= 1) {
    cmd.ack = true;
  }
  session.realm!.cmdPush(ctx, cmd);
};

handlers.puback = function (ctx, session, message) {
  this.checkRealm(session);
  const qid = session.fetchWaitId(message.messageId);
  if (qid) {
    session.realm!.cmdConfirm(ctx, {
      id: qid
    });
    if (session.secureDetails && session.secureDetails.clientId) {
      session.realm!.runInboundEvent(
        session.getSid(),
        ['$FOX', 'clientOffset', session.secureDetails.clientId] as any,
        qid
      );
    }
  }
};

handlers.pingreq = function (ctx, session, message) {
  ctx.mqttSend({ cmd: 'pingresp' });
};

handlers.subscribe = function (ctx, session, message) {
  this.checkRealm(session);
  const pkg = {
    id: message.messageId,
    granted: [] as number[],
    count: message.subscriptions.length
  };
  ctx.setSubscribePkg(pkg);
  const afterId = session.getLastPublishedId();
  for (let index = 0; index < message.subscriptions.length; index++) {
    const qos = Math.min(message.subscriptions[index].qos, 1);
    pkg.granted[index] = qos;
    const uri = mqttParse(message.subscriptions[index].topic);
    const opt: any = { retainedState: true };
    if (message.subscriptions[index].snapshot === true) {
      opt.snapshot = true;
    }
    if (qos > 0) {
      opt.keepTraceFlag = true;
    }
    if (afterId) {
      opt.after = afterId;
    }
    const cmd = { id: index, uri, opt };
    if (this.checkAuthorize(ctx, cmd, 'subscribe')) {
      session.realm!.cmdTrace(ctx, cmd);
    }
  }
};
