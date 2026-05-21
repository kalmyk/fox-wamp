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
  id?: CommandId
  qid?: any
  traceId?: any
  subId?: any
  unr?: any
  uri?: any
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
