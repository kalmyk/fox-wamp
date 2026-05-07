import * as net from 'net';
// @ts-ignore
import { generate, parser as ParserBuild } from 'mqtt-packet';
import { SESSION_TX } from '../messages';
import { MqttGate, MqttSocketWriterContext } from './gate';
import Router from '../router';
import { Session } from '../session';

export class MqttWebSocketWriter {
  constructor(private socket: net.Socket, private session: Session, private router: Router) {}

  mqttPkgWrite = (data: any, callback?: (err?: Error) => void): void => {
    this.router.emit(SESSION_TX, this.session, data);
    this.socket.write(generate(data), callback as any);
  };

  mqttPkgClose = (): void => {
    this.socket.end();
  };
}

export default function listenMqttServer(gate: MqttGate, options: net.ListenOptions): void {
  const router = gate.getRouter();
  const _server = net.createServer((socket) => {
    const session = router.createSession();
    session.setGateProtocol('mqtt.socket');
    const socketWriter = new MqttWebSocketWriter(socket, session, router);

    const parser = ParserBuild();

    parser.on('packet', (data: any) => {
      const ctx = gate.createContext(session, socketWriter);
      router.emit('session.Rx', session, data);
      gate.handle(ctx, session, data);
    });

    socket.on('data', (chunk) => {
      parser.parse(chunk);
    });

    socket.on('end', () => {
    });

    socket.on('close', () => {
      router.removeSession(session);
    });

    socket.on('error', (exc) => {
      console.log('ignoring exception:' + exc, session.getSid());
    });
  });
  _server.listen(options);
}
