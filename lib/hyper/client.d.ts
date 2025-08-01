export type CallbackFn = (...args: any[]) => any

export class HyperApiContext {
  constructor(router: any, session: any, realm: any)
  sendInvoke(cmd: any): void
  sendResult(cmd: any): void
  sendEvent(cmd: any): void
  sendOkey(cmd: any): void
  sendRegistered(cmd: any): void
  sendUnregistered(cmd: any): void
  sendSubscribed(cmd: any): void
  sendUnsubscribed(cmd: any): void
  sendEndSubscribe(cmd: any): void
  sendPublished(cmd: any): void
  sendError(cmd: any, code: any, text: any): void
}

export class HyperSocketFormatter {
  constructor(socketWriter: any)
  sendCommand(id: any, command: any): number
  cmdEcho(ctx: any, cmd: any): number
  cmdRegRpc(ctx: any, cmd: any): number
  cmdUnRegRpc(ctx: any, cmd: any): number
  cmdCallRpc(ctx: any, cmd: any): number
  cmdTrace(ctx: any, cmd: any): number
  cmdUnTrace(ctx: any, cmd: any): number
  cmdPush(ctx: any, cmd: any): number
  cmdYield(ctx: any, cmd: any): void
  onMessage(msg: any): void
}

export class HyperClient {
  constructor(realm: any, ctx: HyperApiContext)

  echo(data: any): Promise<any>
  register(uri: string, cb: CallbackFn, opt?: any): Promise<any>
  unregister(regId: any): Promise<any>
  callrpc(uri: string, data: any, opt?: any): Promise<any>
  subscribe(uri: string, cb: CallbackFn, opt?: any): Promise<any>
  unsubscribe(subId: any): Promise<any>
  publish(uri: string, data: any, opt?: any): Promise<any>
  pipe(writeToClient: HyperClient, topic: string, opt?: any): Promise<any>
  afterOpen(callback: CallbackFn): any
}

export type OnOpenCallback = () => void | Promise<void>

export class RemoteHyperClient extends HyperClient {
  constructor(formatter: any)
  onopen(callback: OnOpenCallback): Promise<void>
  applyOnOpen(): Promise<void>
  login(data: any): Promise<any>
}
