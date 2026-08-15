import { errorCodes } from './realm_error';
import { Router } from './router';
import { RealmCommand } from './types';
export { getBodyValue } from './tools';

export class BaseGate {
  _router: Router
  _authHandler: any
  _authMethods: string[]

  constructor(router: Router) {
    this._router = router
    this._authHandler = undefined
    this._authMethods = []
  }

  setAuthHandler(authHandler: any): void {
    this._authHandler = authHandler
    if (typeof authHandler.getAuthMethods === 'function') {
      this._authMethods = authHandler.getAuthMethods()
    }
  }

  getAcceptedAuthMethod(methods: string[]): string | undefined {
    for (let i = 0; i < this._authMethods.length; i++) {
      if (methods.includes(this._authMethods[i])) {
        return this._authMethods[i]
      }
    }
    return undefined
  }

  isAuthRequired(session: any): boolean {
    return (typeof this._authHandler !== 'undefined')
  }

  isAuthorizeRequired(): boolean {
    return (typeof this._authHandler !== 'undefined' && typeof this._authHandler.authorize === 'function');
  }

  checkAuthorize(ctx: any, cmd: RealmCommand, funcClass: string): boolean {
    if (this.isAuthorizeRequired() &&
      !this._authHandler.authorize(ctx.getSession(), funcClass, cmd.uri))
    {
      ctx.sendError(cmd, errorCodes.ERROR_AUTHORIZATION_FAILED)
      return false
    }
    return true
  }

  getRouter(): Router {
    return this._router
  }
}
