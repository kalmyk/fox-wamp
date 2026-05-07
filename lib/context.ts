import { Router } from './router'
import { Session } from './session'

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

  public sendInvoke?(msg: any, qid: any, uri: any, subId: any, hdr: any, data: any, opt: any): void
  public sendResult?(result: any): void
  public sendEvent?(cmd: any): void
  public sendAck?(msg: any): void
  public sendError?(msg: any, errorCode: string, text?: string): void
  public sendOkey?(msg: any): void
  public sendSubscribed?(msg: any): void
  public sendEndSubscribe?(msg: any): void
  public sendRegistered?(msg: any): void
  public sendUnregistered?(msg: any): void
  public sendPublished?(result: any): void;
  public sendUnsubscribed?(msg: any): void;
}
