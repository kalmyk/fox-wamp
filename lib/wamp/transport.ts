const WebSocket = require('ws')
import { SESSION_TX, SESSION_RX, SESSION_ALERT, SESSION_DEBUG } from '../messages'
import { WampGate, WampSocketWriterContext } from './gate'
import Router from '../router'
import { Session } from '../session'

class WampSocketWriter {
  public wampPkgWrite: (msg: any, callback?: Function) => void;
  public wampPkgClose: (code: number, reason: string) => void;

  constructor(wsclient: any, session: Session, router: Router) {
    let defaultCallback = (error?: Error) => {
      if (error) {
        router.emit(SESSION_ALERT, session, 'Failed to send message:', error)
        wsclient.close(1011, 'Unexpected error')
      }
    };

    this.wampPkgWrite = (msg: any, callback?: Function) => {
      let data = JSON.stringify(msg);
      router.emit(SESSION_TX, session, data);
      if (wsclient.readyState === WebSocket.OPEN) {
        wsclient.send(
          data,
          (typeof callback === 'function') ? callback as any : defaultCallback
        )
      }
    }

    this.wampPkgClose = (code: number, reason: string) => {
      router.emit(SESSION_DEBUG, session, 'Closing WebSocket connection: [' + code + '] ' + reason);
      wsclient.close(code, reason);
    };
  }
}

export class WampServer extends (WebSocket.Server as any) {
  constructor(gate: WampGate, wsOptions: any) {
    if (!wsOptions.disableProtocolCheck) {
      // We need to verify that the subprotocol is wamp.2.json
      wsOptions.handleProtocols = function (protocols: Set<string>, request: any) {
        if (protocols.has('wamp.2.json')) {
          return 'wamp.2.json';
        }
        console.log('[wamp.2.json] protocol not found', protocols);
        return false;
      };
    }

    super(wsOptions);

    this.on('connection', (wsclient: any) => {
      const session = gate.getRouter().createSession();
      session.setGateProtocol('wamp.2.json');
      let sender = new WampSocketWriter(wsclient, session, gate.getRouter());

      wsclient.on('close', () => {
        gate.getRouter().removeSession(session);
      });

      wsclient.on('message', (data: any) => {
        let ctx = gate.createContext(session, sender);
        try {
          const strData = data.toString('utf-8');
          ctx.emit(SESSION_RX, strData);
          let msg = JSON.parse(strData);
          gate.handle(ctx, session, msg);
        } catch (e) {
          ctx.emit(SESSION_ALERT, 'invalid json', data);
          ctx.wampClose(1003, 'protocol violation');
          console.log(e);
        }
      });
    });
  }
}
