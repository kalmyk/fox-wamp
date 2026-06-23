import { BODY_ADVANCE_SEGMENT_RESOLVED } from './hyper.h'

export const SEGMENT_COMMITTED = 'segment-committed'

export type CommittedSegmentRecord = {
  eventId: string
  realm: string
  uri: string[]
  data: any
  opt: any
  sid: string
  shard: number
}

export type CommittedSegmentEvent = BODY_ADVANCE_SEGMENT_RESOLVED & {
  events: CommittedSegmentRecord[]
}

export interface SegmentCommittedSource {
  on(event: typeof SEGMENT_COMMITTED, listener: (event: CommittedSegmentEvent) => void): any
}

