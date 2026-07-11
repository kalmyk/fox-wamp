import { ComplexId } from './makeid'
import { StorageRecord, StorageStatus, SchemaRecord } from '../types'

export const INTRA_REALM_NAME = 'sys'


export type AdvanceOffsetId = {
  segment: number   // timestamp in msec
  offset: number    // offset in this segment
}

export enum Event {
  BEGIN_ADVANCE_SEGMENT = 'BEGIN_ADVANCE_SEGMENT',
  KEEP_ADVANCE_HISTORY = 'KEEP_ADVANCE_HISTORY',  // sharded: delivered to KEEP_ADVANCE_HISTORY.<shardTag>
  TRIM_ADVANCE_SEGMENT = 'TRIM_ADVANCE_SEGMENT',  // sub-topic to dedicated gate
  ADVANCE_SEGMENT_OVER = 'ADVANCE_SEGMENT_OVER',

  GENERATE_DRAFT = 'GENERATE_DRAFT',
  PICK_CHALLENGER = 'PICK_CHALLENGER', // sub-topic to dedicated sync
  ELECT_SEGMENT = 'ELECT_SEGMENT',

  ADVANCE_SEGMENT_RESOLVED = 'advance-segment-resolved', // broadcast; entry nodes filter by advanceOwner
  ADVANCE_SEGMENT_FAILED = 'advance-segment-failed',     // broadcast; entry nodes filter by advanceOwner
  INIT_ENTRY_ACCEPTED = 'INIT_ENTRY_ACCEPTED',
}

export namespace Event {
  export const beginAdvanceSegmentTopic = (shardTag: number) =>
    `${Event.BEGIN_ADVANCE_SEGMENT}.${shardTag}`
  export const keepAdvanceHistoryTopic = (shardTag: number) =>
    `${Event.KEEP_ADVANCE_HISTORY}.${shardTag}`
}

export type BODY_BEGIN_ADVANCE_SEGMENT = {
  advanceOwner: string
  advanceStamp: number // todo rename to advanceStamp  // local entry timestamp
  shardTag: number
}

export type BODY_ADVANCE_SEGMENT_OVER = {
  advanceOwner: string
  advanceStamp: number
  shardTag: number
  totalEvents: number
}

export type BODY_TRIM_ADVANCE_SEGMENT = {
  advanceOwner: string
  advanceStamp: number
}

export type BODY_INIT_ENTRY_ACCEPTED = {
  syncNodeId: string
  advanceOwner: string
  lastSeenAdvanceId: number
}

export type BODY_GENERATE_DRAFT = {
  advanceOwner: string // TODO: origin / relay
  advanceStamp: number
  shardTag: number
}

export type BODY_PICK_CHALLENGER = {
  advanceOwner: string
  advanceStamp: number
  shardTag: number
  draftOwner: string
  draftId: ComplexId
}

export type BODY_KEEP_ADVANCE_HISTORY = {
  advanceOwner: string
  advanceId: AdvanceOffsetId
  shard: number
  realm: string
  data: string
  uri: string[]
  opt: any
  sid: string
}

export type BODY_ELECT_SEGMENT = {
  advanceOwner: string
  advanceStamp: number
  shardTag: number
  voter: string
  challenger: string
}

export type BODY_ADVANCE_SEGMENT_RESOLVED = {
  advanceOwner: string
  advanceStamp: number
  segment: string
}

export type BODY_ADVANCE_SEGMENT_FAILED = {
  advanceOwner: string
  advanceStamp: number
  reason: string
}

export namespace AdminEvent {
  export const KV_LIST = 'fox.admin.kv.list'
  export const KV_ACTIVATE = 'fox.admin.kv.activate'
  export const KV_RESET = 'fox.admin.kv.reset'
  export const SCHEMA_LIST = 'fox.admin.schema.list'
  export const SCHEMA_ADD = 'fox.admin.schema.add'
  export const SCHEMA_DROP = 'fox.admin.schema.drop'
  export const EVENT_SHARD_LIST = 'fox.admin.event.shard.list'
  export const SEGMENT_LIST = 'fox.admin.segment.list'
}

export type AdminKvListRequest = Record<string, never>
export type AdminKvListResponse = { storages: StorageRecord[] }

export type AdminKvActivateRequest = { name: string }
export type AdminKvActivateResponse = { status: StorageStatus; activationTarget: string | null }

export type AdminKvResetRequest = { name: string }
export type AdminKvResetResponse = { status: StorageStatus }

export type AdminSchemaListRequest = Record<string, never>
export type AdminSchemaListResponse = { schemas: SchemaRecord[] }

export type AdminSchemaAddRequest = { label: string; urlPattern: string; schema: object }
export type AdminSchemaAddResponse = { schemaId: string; dataTable: string }

export type AdminSchemaDropRequest = { schemaId: string }
export type AdminSchemaDropResponse = { status: 'deprecated' }

export type AdminEventShardEntry = { shardTag: number; nodeId: string; host: string; port: string }
export type AdminEventShardListResponse = { shards: AdminEventShardEntry[] }

export type SegmentRecord = {
  advanceOwner: string
  advanceStamp: number
  shardTag: number | null
  segmentId: string | null
  msgCount: number | null
  crc32: number | null
  status: string
}
export type AdminSegmentListResponse = { segments: SegmentRecord[] }
