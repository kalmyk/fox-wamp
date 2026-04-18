import Router from './router';
import { BaseRealm } from './realm';

declare class FoxRouter extends Router {
  constructor();
  listenWAMP(wsOptions: any, authHandler?: any): any;
  listenMQTT(wsOptions: any, authHandler?: any): any;
  listenWsMQTT(wsOptions: any, authHandler?: any): any;
  listenHyperNet(wsOptions: any, authHandler?: any): any;
  createRealm(realmName: string): BaseRealm;
}

export = FoxRouter;
