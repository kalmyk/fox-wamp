import * as sqlite from 'sqlite'
import { crc32 } from 'zlib'
import { restoreUri } from '../topic_pattern'
import { BODY_KEEP_ADVANCE_HISTORY } from '../masterfree/hyper.h'

function tableName (realmName: string): string {
  return `segment_registry_${realmName}`
}

export async function createSegmentRegistryTable (db: sqlite.Database, realmName: string): Promise<void> {
  await db.run(
    `CREATE TABLE IF NOT EXISTS ${tableName(realmName)} (
      advance_owner TEXT,
      advance_stamp INTEGER,
      shard_tag INTEGER,
      segment_id TEXT,
      msg_count INTEGER,
      crc32 INTEGER,
      status TEXT,
      PRIMARY KEY (advance_owner, advance_stamp)
    )`
  )
}

export async function insertSegmentOver (db: sqlite.Database, realmName: string, advanceOwner: string, advanceStamp: number, shardTag: number): Promise<void> {
  await db.run(
    `INSERT OR IGNORE INTO ${tableName(realmName)} (advance_owner, advance_stamp, shard_tag, status) VALUES (?, ?, ?, 'over')`,
    [advanceOwner, advanceStamp, shardTag]
  )
}

export async function updateSegmentResolved (db: sqlite.Database, realmName: string, advanceOwner: string, advanceStamp: number, shardTag: number, segmentId: string, msgCount: number, crc: number): Promise<void> {
  await db.run(
    `INSERT INTO ${tableName(realmName)} (advance_owner, advance_stamp, shard_tag, segment_id, msg_count, crc32, status)
     VALUES (?, ?, ?, ?, ?, ?, 'resolved')
     ON CONFLICT(advance_owner, advance_stamp) DO UPDATE SET
       segment_id = excluded.segment_id,
       msg_count  = excluded.msg_count,
       crc32      = excluded.crc32,
       status     = 'resolved'`,
    [advanceOwner, advanceStamp, shardTag, segmentId, msgCount, crc]
  )
}

export async function listSegments (db: sqlite.Database, realmName: string, limit: number = 500): Promise<any[]> {
  return db.all(
    `SELECT advance_owner, advance_stamp, shard_tag, segment_id, msg_count, crc32, status FROM ${tableName(realmName)} ORDER BY advance_stamp DESC LIMIT ?`,
    [limit]
  )
}

export function computeUriCrc (events: BODY_KEEP_ADVANCE_HISTORY[]): number {
  return events.reduce((sum, e) => sum + crc32(restoreUri(e.uri)), 0)
}
