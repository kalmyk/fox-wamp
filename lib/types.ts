/*
TODO
  type ApiCommandId = {
    resolve: (value: any) => void
    reject: (reason: any) => void
    cb?: Function
  const cmd: HyperCommand<ApiCommandId> = {
    id: { resolve, reject, cb },
    uri: ['topic'],
    opt: {}
  }

*/

export type Id = string | number

export interface HyperCommand<CommandId = Id> {
  id?: CommandId   // incoming id - id of answer
  qid?: any        // internal id created by engine
  traceId?: any
  subId?: any
  unr?: any
  uri?: string[]
  hdr?: any
  data?: any
  opt?: any
  ack?: boolean
  err?: string | number | null
  rsp?: string
  rqt?: string
  sid?: any
}

export type RealmCommand = HyperCommand<Id>

export enum StorageStatus {
  Inactive = 'inactive',
  Refreshing = 'refreshing',
  Online = 'online',
  Failed = 'failed',
}

export interface StorageRecord {
  name: string
  realmName: string
  uriPattern: string
  schemaId: string
  startedAt: number | null
  status: StorageStatus
  currentPosition: string | null
  lastError: string | null
}
