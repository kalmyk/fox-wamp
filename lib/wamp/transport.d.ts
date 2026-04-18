import { WampGate } from './gate';

declare class WampServer {
  constructor(gate: WampGate, options: any);
}

export = WampServer;
