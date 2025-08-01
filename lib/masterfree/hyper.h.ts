import { ComplexId } from './makeid'

export const INTRA_REALM_NAME = 'sys'

export type AdvanceOffsetId = {
  segment: string
  offset: number
}

export enum Event {
  BEGIN_ADVANCE_SEGMENT = 'BEGIN_ADVANCE_SEGMENT',
  KEEP_ADVANCE_HISTORY = 'KEEP_ADVANCE_HISTORY',
  TRIM_ADVANCE_SEGMENT = 'TRIM_ADVANCE_SEGMENT',  // sub-topic to dedicated gate
  ADVANCE_SEGMENT_OVER = 'ADVANCE_SEGMENT_OVER',
  
  GENERATE_DRAFT = 'GENERATE_DRAFT',
  PICK_CHALLENGER = 'PICK_CHALLENGER',
  ELECT_SEGMENT = 'ELECT_SEGMENT',

  ADVANCE_SEGMENT_RESOLVED = 'advance-segment-resolved', // sub-topic to dedicated gate to send ACK
}

export type BODY_BEGIN_ADVANCE_SEGMENT = {
  advanceOwner: string
  advanceSegment: string
}

export type BODY_ADVANCE_SEGMENT_OVER = {
  advanceSegment: string
}

export type BODY_TRIM_ADVANCE_SEGMENT = {
  advanceOwner: string
  advanceSegment: string
}

export type BODY_GENERATE_DRAFT = {
  advanceOwner: string
  advanceSegment: string
}

export type BODY_PICK_CHALLENGER = {
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

export type BODY_ELECT_SEGMENT = {
  advanceOwner: string
  advanceSegment: string
  challenger: string
}

export type BODY_ADVANCE_SEGMENT_RESOLVED = {
  advanceOwner: string
  advanceSegment: string
  segment: string
}