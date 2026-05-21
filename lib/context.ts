import { Router } from './router'
import { Session } from './session'
import { HyperCommand } from './types'

export class Context {
  public router: Router
  public session: Session

  constructor(router: Router, session: Session) {
    this.router = router
    this.session = session
  }

  public getSession(): Session {
    return this.session
  }

  public isActive(): boolean {
    return this.session.isActive()
  }

  public emit(event: string, message: any, data?: any): void {
    this.router.emit(event, this.session, message, data)
  }

  public setSendFailed(e: Error): void {
    this.session.setSendFailed(e)
  }

  public sendInvoke?(cmd: HyperCommand<any>): void
  public sendResult?(result: HyperCommand<any>): void
  public sendEvent?(cmd: HyperCommand<any>): void
  public sendAck?(msg: any): void
  public sendError?(msg: HyperCommand<any>, errorCode: string, text?: string): void
  public sendOkey?(msg: HyperCommand<any>): void
  public sendSubscribed?(msg: HyperCommand<any>): void
  public sendEndSubscribe?(msg: HyperCommand<any>): void
  public sendRegistered?(msg: HyperCommand<any>): void
  public sendUnregistered?(msg: HyperCommand<any>): void
  public sendPublished?(result: HyperCommand<any>): void;
  public sendUnsubscribed?(msg: HyperCommand<any>): void;
}
