import { MqttGate } from './gate';

declare function listenMqttServer(gate: MqttGate, options: any): void;

export = listenMqttServer;
