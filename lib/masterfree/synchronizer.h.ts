import { ComplexId } from './makeid'

export const EVENT_DRAFT_SEGMENT = 'draftSegment'

export type StartDraftSegmentMessage = {
    draftId: ComplexId
    draftOwner: string
    advanceSegment: string
    advanceOwner: string
}

export type SyncIdMessage = {
    maxId: ComplexId
    advanceSegment: string
    advanceOwner: string
}
