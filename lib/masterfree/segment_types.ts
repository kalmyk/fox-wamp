import { Event, CommittedSegmentRecord, BODY_SEGMENT_COMMITTED } from './hyper.h'

// SEGMENT_COMMITTED is Event.SEGMENT_COMMITTED (hyper.h.ts) — the canonical, pipeable wire
// event. This module re-exports it under its original name for the local, in-process
// EventEmitter consumers (DbFactory/ProjectionListener) that predate it being piped to entry
// nodes and don't go through a HyperClient realm at all.
export const SEGMENT_COMMITTED = Event.SEGMENT_COMMITTED

export { CommittedSegmentRecord }
export type CommittedSegmentEvent = BODY_SEGMENT_COMMITTED

export interface SegmentCommittedSource {
  on(event: typeof SEGMENT_COMMITTED, listener: (event: CommittedSegmentEvent) => void): any
}
