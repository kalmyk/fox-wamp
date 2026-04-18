import Router from './router';

export declare function getBodyValue(body: any): any;

export declare class BaseGate {
  _router: Router;
  _authHandler: any;
  _authMethods: string[];

  constructor(router: Router);
  setAuthHandler(authHandler: any): void;
  getAcceptedAuthMethod(methods: string[]): string | undefined;
}
