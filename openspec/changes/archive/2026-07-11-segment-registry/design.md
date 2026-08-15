## Context

`StorageTask` in `lib/masterfree/storage.ts` already handles the full advance-segment lifecycle — it receives `BEGIN_ADVANCE_SEGMENT`, `ADVANCE_SEGMENT_OVER`, and `ADVANCE_SEGMENT_RESOLVED` on the sys realm. The data needed for the registry table is already flowing through these handlers; it just isn't persisted anywhere.

The `BODY_BEGIN_ADVANCE_SEGMENT` message carries `advanceOwner`, `advanceStamp`, and `shardTag`. `BODY_ADVANCE_SEGMENT_OVER` carries the same trio. `BODY_ADVANCE_SEGMENT_RESOLVED` carries `advanceOwner`, `advanceStamp`, and the resolved `segment` string (the persistent event-ID prefix). The message count and CRC must be derived from the `HistoryBuffer` at commit time inside `dbSaveSegment`.

## Goals / Non-Goals

**Goals:**
- One SQLite row per advance segment per storage node, written atomically alongside the event history commit
- CRC is the sum of per-event `CRC32(restoreUri(uri))` values across all messages in the segment
- Row exists from `BEGIN_ADVANCE_SEGMENT` so partial/failed segments are also visible
- `foxctl segment list` shows recent segments in a human-readable table
- `fox.admin.segment.list` admin RPC returns segments (optional but included)

**Non-Goals:**
- Cross-node segment aggregation (each node has its own table; no cluster-wide view)
- CRC algorithm negotiation — CRC-32 is fixed
- Segment table replication or synchronisation
- Historical backfill of segments that predate this change

## Decisions

### 1. Table location: same database as event history

The segment registry lives in the same SQLite file as `event_history_*`. This keeps the schema self-contained per storage node and lets `BEGIN TRANSACTION` wrap both the history insert and the segment-registry update atomically in `dbSaveSegment`.

Alternatives considered:
- Separate database file: adds connection overhead and cross-file transaction complexity with no benefit.

### 2. Row lifecycle: insert on OVER, update on RESOLVED

```
No action on BEGIN_ADVANCE_SEGMENT (realm is not known at this point)

INSERT on ADVANCE_SEGMENT_OVER (one row per realm that has events):
  advance_owner, advance_stamp, shard_tag, realm, status='over'
  → look up HistoryBuffer for advanceOwner:advanceStamp
  → skip if no buffer (not our shard)
  → group events by realm; for each realm call insertSegmentOver(...)

UPDATE on ADVANCE_SEGMENT_RESOLVED (inside dbSaveSegment transaction):
  segment_id, msg_count, crc32, status='resolved'
  → msg_count and crc32 are per-realm slices of the segment
```

`ADVANCE_SEGMENT_OVER` is the first point where both `shardTag` and the buffered events (with their realms) are available. Using only realms that actually have events avoids phantom rows.

Alternatives considered:
- Insert on `BEGIN_ADVANCE_SEGMENT`: realm not available yet, ruled out.
- Insert on `RESOLVED` only: loses visibility into over-but-not-resolved segments (e.g. consensus timeout).

### 3. Table created inside `createHistoryTables`, named per-realm

`segment_registry_<realm>` is created inside the existing `createHistoryTables` function in `lib/sqlite/history.ts`, alongside `event_history_<realm>`. It is therefore initialised lazily via `ensureRealm` — the same pattern used for event tables, with no new startup ordering or async-in-constructor problems. By the time `ADVANCE_SEGMENT_OVER` fires and we attempt to INSERT, `ensureRealm` has already been called for every realm that has events in the buffer, so the table always exists at INSERT time.

### 4. CRC-32 summed over per-event URIs

For each event in the segment (in commit order), compute `CRC32(restoreUri(uri))` — where `restoreUri` converts the URI array to its canonical dot-separated string, the same value written to `event_history_*`. Sum all per-event CRC32 values and store the total as a 64-bit `INTEGER` (SQLite's native integer width). No separator is needed; each URI is hashed independently before summing.

```
crc32_total = Σ CRC32(restoreUri(event.uri))  for each event in segment
```

Recomputable from the stored `msg_uri` column in `event_history_*` without any extra state.

Alternatives considered:
- CRC over concatenated URIs: requires a separator to avoid `"a.b"+"c"` == `"a"+"b.c"` collision.
- SHA-256: stronger but unnecessary for accidental-corruption detection.

### 5. `BEGIN_ADVANCE_SEGMENT` arrives on the sys realm — not from the entry connection

`StorageTask` already subscribes to `Event.BEGIN_ADVANCE_SEGMENT` (which is piped from the entry node via `listenEntry`). The insert can be done directly in that handler. No new subscription is needed.

### 5. `foxctl segment list` uses `--realm` like other commands

`segment_registry_<realm>` is per-realm, so `fox.admin.segment.list` queries the table for the realm it is registered on — the same pattern as `kv list` and `schema list`. `foxctl segment list --realm testnet` returns segments written to the `testnet` realm on that node.

## Risks / Trade-offs

- **Write amplification**: every segment adds one INSERT + two UPDATEs. At high segment rates (e.g. 100/s) this is negligible next to the history inserts already being done.
- **`zlib.crc32`**: available since Node 20; no polyfill needed for this runtime.
- **ADVANCE_SEGMENT_OVER may arrive before BEGIN**: unlikely in practice but possible on replay. Use `INSERT OR IGNORE` / `UPDATE OR IGNORE` to handle out-of-order delivery safely.
- **Failed segments**: `ADVANCE_SEGMENT_FAILED` is not handled — the row stays in `status='over'` indefinitely. A future cleanup job can prune stale rows.

## Migration Plan

No schema migration needed for existing `event_history_*` tables. The `segment_registry` table is created with `CREATE TABLE IF NOT EXISTS` on first startup. Rows before this change simply don't exist.
