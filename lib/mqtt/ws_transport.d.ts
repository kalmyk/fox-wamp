import WebSocket from 'ws';
import { MqttGate } from './gate';

export declare function MqttSocketWriter(wsclient: any, session: any, router: any): void;

declare class WsMqttServer extends WebSocket.Server {
  constructor(gate: MqttGate, wsOptions: any);
}

export = WsMqttServer;
