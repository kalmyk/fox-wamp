import WebSocket from 'ws';
// @ts-ignore
import { generate, parser } from 'mqtt-packet';
import { SESSION_TX, SESSION_RX, SESSION_ALERT, SESSION_DEBUG } from '../messages';
import { MqttGate, MqttSocketWriterContext } from './gate';
import { Router } from '../router';
import { Session } from '../session';

export class MqttSocketWriter {
  constructor(private wsclient: WebSocket, private session: Session, private router: Router) {}

  private defaultCallback = (error?: Error): void => {
    if (error) {
      this.router.emit(SESSION_ALERT, 'Failed to send message:', error);
      this.mqttPkgClose(1011, 'Unexpected error');
    }
  };

  mqttPkgWrite = (msg: any, callback?: (err?: Error) => void): void => {
    this.router.emit(SESSION_TX, this.session, msg);
    const data = generate(msg);
    if (this.wsclient.readyState === WebSocket.OPEN) {
      this.wsclient.send(
        data,
        (typeof callback === 'function') ? callback : this.defaultCallback
      );
    }
  };

  mqttPkgClose = (code: number, reason: string): void => {
    this.router.emit(SESSION_DEBUG, this.session, 'Closing WebSocket connection: [' + code + '] ' + reason);
    this.wsclient.close(code, reason);
  };
}

export default class WsMqttServer extends WebSocket.Server {
  constructor(gate: MqttGate, wsOptions: WebSocket.ServerOptions & { disableProtocolCheck?: boolean }) {
    if (!wsOptions.disableProtocolCheck) {
      wsOptions.handleProtocols = (protocols: Set<string>, request: any) => {
        if (protocols.has('mqtt')) {
          return 'mqtt';
        }
        console.log('[mqtt] protocol not found', protocols);
        return false;
      };
    }

    super(wsOptions);
    const router = gate.getRouter();

    this.on('connection', (wsclient: WebSocket) => {
      const session = router.createSession();
      session.setGateProtocol('mqtt.web.socket');
      const mqttSocketWriter = new MqttSocketWriter(wsclient, session, router);

      wsclient.on('close', () => {
        router.removeSession(session);
      });

      const mqttParser = parser();

      mqttParser.on('packet', (data: any) => {
        router.emit(SESSION_RX, session, data);
        const ctx = gate.createContext(session, mqttSocketWriter);
        gate.handle(ctx, session, data);
      });

      wsclient.on('message', (data: any) => {
        mqttParser.parse(data);
      });
    });
  }
}
