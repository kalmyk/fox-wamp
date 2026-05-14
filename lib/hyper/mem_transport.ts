import { HyperClient, HyperSocketFormatter } from './client';
import { BaseRealm } from '../realm';

export class MemServer {
  private _streams: any[] = [];
  private _flushRequested = false;

  constructor(private gate: any) {}

  requestFlush(): void {
    if (!this._flushRequested) {
      this._flushRequested = true;
      process.nextTick(() => this.processStreams());
    }
  }

  processStreams(): void {
    let found = false;
    this._flushRequested = false;
    for (let i = 0; i < this._streams.length; i++) {
      found = found || this._streams[i].handleBuffer();
    }
    if (found) {
      this.requestFlush();
    }
  }

  addSender(pipe: any): void {
    this._streams.push(pipe);
  }

  createClient(realm: BaseRealm): HyperClient {
    const session = this.gate.getRouter().createSession();
    session.setGateProtocol('inmemory.hyper');
    realm.joinSession(session);
    const realmAdapter = new (RealmAdapter as any)(this, this.gate, session);
    const listener = new (SessionMemListener as any)(this, realmAdapter);
    const clientFormater = new HyperSocketFormatter(realmAdapter);

    realmAdapter.setListener({ hyperPkgWrite: clientFormater.onMessage }); // zero pipe

    const client = new HyperClient(
      clientFormater,
      listener
    );
    client.setSession(session);
    return client;
  }
}

export function SessionMemListener(this: any, memServer: MemServer, transport: any): void {
  const _buffer: any[] = [];
  memServer.addSender(this);

  this.hyperPkgWrite = function (msg: any) {
    _buffer.push(msg);
    memServer.requestFlush();
  };

  this.handleBuffer = function () {
    if (_buffer.length === 0) {
      return false;
    }
    const msg = _buffer.shift();
    if (msg === null) {
      transport.sender._memClose();
    } else {
      transport.onMessage(msg);
    }
    return true;
  };

  this.hyperPkgClose = function () {
    this.hyperPkgWrite(null);
  };
}

export function RealmAdapter(this: any, memServer: MemServer, gate: any, session: any): void {
  const _buffer: any[] = [];
  let listener: any = null;
  memServer.addSender(this);

  this.setListener = function (_listener: any) {
    listener = _listener;
  };

  this.hyperPkgWrite = function (msg: any) {
    _buffer.push(msg);
    memServer.requestFlush();
  };

  this.handleBuffer = function () {
    if (_buffer.length === 0) {
      return false;
    }

    const msg = _buffer.shift();
    const ctx = gate.createContext(session, listener);
    gate.handle(ctx, session, msg);

    return true;
  };

  this._memClose = function () {
    gate.getRouter().removeSession(session);
  };
}
