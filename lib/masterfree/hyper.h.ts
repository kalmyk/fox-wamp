import { ComplexId } from './makeid'

export const INTRA_REALM_NAME = 'sys'

export type AdvanceOffsetId = {
  segment: string
  offset: number
}

export enum Event {
  BEGIN_ADVANCE_SEGMENT = 'begin-advance-segment',
  ADVANCE_SEGMENT_OVER = 'advance-segment-over',
  KEEP_ADVANCE_HISTORY = 'keep-advance-history',
  TRIM_ADVANCE_SEGMENT = 'trim-advance-segment',
  DRAFT_SEGMENT = 'DRAFT_SEGMENT',
  GENERATE_SEGMENT = 'GENERATE_SEGMENT',
  SYNC_ID = 'syncId',
  CHALLENGER_EXTRACT = 'CHALLENGER_EXTRACT'
}

export type BODY_BEGIN_ADVANCE_SEGMENT = {
  advanceOwner: string, // origin
  advanceSegment: string,
}

export type BODY_ADVANCE_SEGMENT_OVER = {
  advanceSegment: string
}

export type BODY_TRIM_ADVANCE_SEGMENT = {
  advanceSegment: string
}

export type BODY_GENERATE_SEGMENT = {
  advanceOwner: string
  advanceSegment: string
}

export type BODY_DRAFT_SEGMENT = {
  advanceOwner: string
  advanceSegment: string
  draftOwner: string
  draftId: ComplexId
}

export type BODY_KEEP_ADVANCE_HISTORY = {
  advanceId: AdvanceOffsetId
  realm: string
  data: string
  uri: string[]
  opt: any
  sid: string
}

export type BODY_SYNC_ID = {
  maxId: ComplexId
  syncId: ComplexId
  advanceSegment: string
  advanceOwner: string
}

export type BODY_CHALLENGER_EXTRACT = {
  challenger: string
  advanceOwner: string
  advanceSegment: string
}
