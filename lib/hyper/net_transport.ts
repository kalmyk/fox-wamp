import * as net from 'net';
// @ts-ignore
import * as msgpack from 'msgpack-lite';
import { SESSION_DEBUG } from '../messages';
import { HyperSocketFormatter, RemoteHyperClient } from './client';
import { FoxGate } from './gate';
import { Router } from '../router';
import { Session } from '../session';

export class HyperNetWriter {
  constructor(private socket: net.Socket, private session: Session | null, private router: Router | any) {}

  hyperPkgWrite(msg: any, callback?: (err?: Error | null) => void): void {
    const pkg = msgpack.encode(msg);
    this.socket.write(pkg, (err) => {
      if (callback) callback(err || null);
    });
  }

  hyperPkgClose(code: number, reason: string): void {
    if (this.session && this.router && typeof this.router.emit === 'function') {
        this.router.emit(SESSION_DEBUG, this.session, 'Closing NetSocket connection: [' + code + '] ' + reason);
    }
    this.socket.end();
  }
}

export function listenHyperNetServer(gate: FoxGate, options: net.ListenOptions): net.Server {
  const router = gate.getRouter();
  const _server = net.createServer((socket) => {
    const session = router.createSession();
    session.setGateProtocol('hyper.net');
    const socketWriter = new HyperNetWriter(socket, session, router);
    const decodeStream = msgpack.createDecodeStream();

    socket.pipe(decodeStream).on('data', (msg: any) => {
      const ctx = gate.createContext(session, socketWriter);
      gate.handle(ctx, session, msg);
    });

    socket.on('end', () => {
      console.log('event:socket-end');
    });

    socket.on('close', () => {
      router.removeSession(session);
    });

    socket.on('error', (exc) => {
      console.log("ignoring exception:" + exc, session.getSid());
    });
  });
  _server.listen(options);

  return _server;
}

export interface HyperNetClientOptions {
  host: string;
  port: number;
  maxReconnectAttempts?: number;
  reconnectDelay?: number;
}

export class HyperNetClient extends RemoteHyperClient {
  private socket: net.Socket;
  private isClosing = false;
  private reconnectAttempts = 0;
  private maxReconnectAttempts: number;
  private reconnectDelay: number;
  private conf: HyperNetClientOptions;
  private _connectResolve: ((val: this) => void) | null = null;

  constructor(params: HyperNetClientOptions) {
    const socket = new net.Socket();
    const socketWriter = new HyperNetWriter(socket, null, null);
    const formater = new HyperSocketFormatter(socketWriter);
    super(formater);

    this.socket = socket;
    this.conf = params;
    this.maxReconnectAttempts = params.maxReconnectAttempts ?? -1;
    this.reconnectDelay = params.reconnectDelay ?? 1000;

    const decoder = new (msgpack as any).Decoder();
    decoder.on('data', (msg: any) => {
      formater.onMessage(msg);
    });

    this.socket.on('connect', () => {
      console.log('HyperNetClient:Connection established', this.conf);
      this.reconnectAttempts = 0;
      if (this._connectResolve) {
        this._connectResolve(this);
        this._connectResolve = null;
      }
      this.applyOnOpen();
    });

    this.socket.on('error', (err) => {
      if (this.isClosing) return;
      console.log('HyperNetClient:Connection ERROR', err);
    });

    this.socket.on('timeout', () => {
      console.log('HyperNetClient:Connection timeout');
    });

    this.socket.on('drain', () => {
      console.log('HyperNetClient:Socket drained');
    });

    this.socket.on('data', (chunk) => {
      decoder.decode(chunk);
    });

    this.socket.on('close', () => {
      console.log('HyperNetClient:Connection closed');
      if (this.isClosing) return;
      if (this.maxReconnectAttempts < 0 || this.reconnectAttempts < this.maxReconnectAttempts) {
        this.reconnectAttempts++;
        console.log('Reconnecting...', this.conf);
        setTimeout(() => {
          this.connect().catch(() => {});
        }, this.reconnectDelay);
      }
    });

    this.socket.on('end', () => {
      console.log('HyperNetClient:Connection ended');
    });
  }

  connect(): Promise<this> {
    this.isClosing = false;
    return new Promise((resolve) => {
      this._connectResolve = resolve;
      this.socket.connect(this.conf.port, this.conf.host);
    });
  }

  close(): void {
    this.isClosing = true;
    this.socket.end();
  }

  getSocket(): net.Socket {
    return this.socket;
  }

  emit(): void {}
}
