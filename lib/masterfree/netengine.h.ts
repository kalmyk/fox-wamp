import { ComplexId } from './makeid'

export const INTRA_REALM_NAME = 'sys'

export type AdvanceOffsetId = {
  segment: string
  offset: number
}

export type AdvanceHistoryEvent = {
  advanceId: AdvanceOffsetId
  realm: string
  data: string
  uri: string[]
  opt: any
  sid: string
}