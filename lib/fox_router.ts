import * as metaUser from '../ext/metauser'
import { WampGate } from './wamp/gate'
import { MqttGate } from './mqtt/gate'
import { FoxGate } from './hyper/gate'
import { WampServer } from './wamp/transport'
import listenMqttServer from './mqtt/transport'
import WsMqttServer from './mqtt/ws_transport';
import { Router } from './router';
import { BaseRealm } from './realm';
import { MemEngine } from './mono/memengine';
import { listenHyperNetServer } from './hyper/net_transport';
import { MemKeyValueStorage } from './mono/memkv';

class FoxRouter extends Router {
  constructor() {
    super();
    metaUser.registerHandlers(this as any);
  }

  listenWAMP(wsOptions: any, authHandler?: any): any {
    const gate = new WampGate(this);
    if (authHandler) {
      gate.setAuthHandler(authHandler);
    }
    return new WampServer(gate, wsOptions);
  }

  listenMQTT(wsOptions: any, authHandler?: any): any {
    const gate = new MqttGate(this);
    if (authHandler) {
      gate.setAuthHandler(authHandler);
    }
    return listenMqttServer(gate, wsOptions as any);
  }

  listenWsMQTT(wsOptions: any, authHandler?: any): any {
    const gate = new MqttGate(this);
    if (authHandler) {
      gate.setAuthHandler(authHandler);
    }
    return new WsMqttServer(gate, wsOptions);
  }

  listenHyperNet(wsOptions: any, authHandler?: any): any {
    const gate = new FoxGate(this);
    if (authHandler) {
      gate.setAuthHandler(authHandler);
    }
    return listenHyperNetServer(gate, wsOptions);
  }

  createRealm(realmName: string): BaseRealm {
    const realm = new BaseRealm(this, new MemEngine());
    realm.registerKeyValueEngine(['#'], new MemKeyValueStorage());
    return realm;
  }
}

export = FoxRouter;
