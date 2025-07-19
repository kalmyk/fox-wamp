import { OnOpenCallback, RemoteHyperClient } from './client'

export interface HyperNetClientOptions {
  host: string
  port: number
  maxReconnectAttempts?: number
  reconnectDelay?: number
}

export class HyperNetClient extends RemoteHyperClient{
  constructor(options: HyperNetClientOptions)

  connect(): Promise<this>
  close(): void
  getSocket(): any
  onopen(cb: OnOpenCallback): Promise<void>
  login(data: any): Promise<any>
  applyOnOpen(): Promise<void>
  // Add other methods as needed, e.g.:
  // publish(uri: string, data: any, opt?: any): any
  // subscribe(uri: string, cb: Function, opt?: any): any
}

export function listenHyperNetServer(gate: FoxGate, options: any): void
