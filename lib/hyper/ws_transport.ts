import WebSocket from 'ws';
// @ts-ignore
import * as msgpack from 'msgpack-lite';
import { SESSION_TX, SESSION_RX, SESSION_DEBUG } from '../messages';
import { HyperSocketFormatter, RemoteHyperClient } from './client';
import { FoxGate } from './gate';
import { Router } from '../router';
import { Session } from '../session';

export class HyperWSWriter {
  constructor(private wsclient: WebSocket, private session: Session | null, private router: Router | any) {}

  hyperPkgWrite(msg: any, callback?: (err?: Error) => void): void {
    const pkg = msgpack.encode(msg);
    if (this.session && this.router) {
      this.router.emit(SESSION_TX, this.session, pkg);
    }
    this.wsclient.send(pkg, callback);
  }

  hyperPkgClose(code: number, reason: string): void {
    if (this.session && this.router) {
      this.router.emit(SESSION_DEBUG, this.session, 'Closing WebSocket connection: [' + code + '] ' + reason);
    }
    this.wsclient.close(code, reason);
  }
}

export function HyperWSServer(gate: FoxGate, options: WebSocket.ServerOptions): WebSocket.Server {
  const router = gate.getRouter();
  const wss = new WebSocket.Server(options);

  wss.on('connection', (ws: WebSocket) => {
    const session = router.createSession();
    session.setGateProtocol('hyper.ws');
    const socketWriter = new HyperWSWriter(ws, session, router);

    ws.on('message', (data: WebSocket.Data) => {
      let buffer: Buffer;
      if (Buffer.isBuffer(data)) {
        buffer = data;
      } else if (data instanceof ArrayBuffer) {
        buffer = Buffer.from(data);
      } else if (Array.isArray(data)) {
        buffer = Buffer.concat(data);
      } else {
        buffer = Buffer.from(data as any);
      }

      router.emit(SESSION_RX, session, buffer.toString('utf-8'));
      let msg: any;
      try {
        msg = msgpack.decode(buffer);
      } catch (e) {
        console.error('Failed to decode msgpack:', e);
        return;
      }
      const ctx = gate.createContext(session, socketWriter);
      gate.handle(ctx, session, msg);
    });

    ws.on('close', () => {
      router.removeSession(session);
    });

    ws.on('error', (exc) => {
      console.log("ignoring exception:" + exc, session.getSid());
    });
  });

  return wss;
}

export interface HyperWSClientOptions {
  host: string;
  port: number;
}

export class HyperWSClient extends RemoteHyperClient {
  private ws: WebSocket | null = null;
  private socketWriter: HyperWSWriter | null = null;
  private formater: HyperSocketFormatter | null = null;
  private conf: HyperWSClientOptions;

  constructor(params: HyperWSClientOptions) {
    super(null as any);
    this.conf = params;
  }

  connect(): Promise<this> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://${this.conf.host}:${this.conf.port}`);
      this.ws = ws;

      ws.on('open', () => {
        this.socketWriter = new HyperWSWriter(ws, null, null);
        this.formater = new HyperSocketFormatter(this.socketWriter);
        (this as any).realm = this.formater;
        (this as any).ctx = this.formater;
        
        resolve(this);
        this.applyOnOpen();
      });

      ws.on('message', (data: WebSocket.Data) => {
        let buffer: Buffer;
        if (Buffer.isBuffer(data)) {
          buffer = data;
        } else if (data instanceof ArrayBuffer) {
          buffer = Buffer.from(data);
        } else if (Array.isArray(data)) {
          buffer = Buffer.concat(data);
        } else {
          buffer = Buffer.from(data as any);
        }

        let msg: any;
        try {
          msg = msgpack.decode(buffer);
        } catch (e) {
          console.error('Failed to decode msgpack:', e);
          return;
        }
        if (this.formater) {
          this.formater.onMessage(msg);
        }
      });

      ws.on('error', (err: any) => {
        console.log('Connection ERROR', err);
        reject(err);
      });

      ws.on('close', () => {
        console.log('event:Connection closed');
      });
    });
  }

  close(): void {
    if (this.ws) this.ws.close();
  }

  getSocket(): WebSocket | null {
    return this.ws;
  }
}
