## 1. Database Schema

- [x] 1.1 Add `storage_desc_${realmName}` table creation logic to `lib/sqlite/history.ts` or a new metadata utility.
- [x] 1.2 Use `current_position TEXT`, include required `schema_id`, and keep realm selection in the table name rather than a row column.
- [x] 1.3 Store `uri_pattern` as canonical dotted FOX topic text and parse it with `defaultParse()` when matching events.
- [x] 1.4 Add `failed` to the status constraint and add `last_error TEXT`.
- [x] 1.5 Ensure the table is created during storage/projection initialization.

## 2. Storage Registry Core

- [x] 2.1 Define `StorageStatus` enum and `StorageRecord` interface in `lib/types.ts`.
- [x] 2.2 Implement `StorageRegistry` class to handle DB operations (register, update status, update position, update last error).
- [x] 2.3 Make registration idempotent and preserve existing `current_position` on restart.
- [x] 2.4 Ensure new registrations start as `inactive`.
- [x] 2.5 Update code and tests to use the singular `storage_desc_${realmName}` table name.
- [x] 2.6 Replace any remaining `storage_type` registry fields with required `schema_id`.

## 3. Committed Segment Payload

- [x] 3.1 Define a committed-segment payload type containing `advanceOwner`, `advanceStamp`, `segment`, and committed event records.
- [x] 3.2 Update `StorageTask.dbSaveSegment` to return committed event records with assigned event IDs.
- [x] 3.3 Update `StorageTask.commit_segment` and the `SEGMENT_COMMITTED` emitter to emit the full committed-segment payload.
- [x] 3.4 Update existing storage tests that listen for `SEGMENT_COMMITTED`.

## 4. KV Projection Listener

- [x] 4.1 Add a dedicated activation command for a registered persistent KV projection.
- [x] 4.2 Activation sets status to `refreshing`, clears `last_error`, records `started_at`, and captures the latest committed event ID for the projection realm as the activation target.
- [x] 4.3 Activation applies matching retained KV mutations in committed event order and persists `current_position` as events are inspected.
- [x] 4.4 Activation sets status to `failed` and writes `last_error` if historical apply fails.
- [x] 4.5 Activation sets status to `online` only after refresh reaches the realm-scoped activation target.
- [x] 4.6 Allow activation from `inactive` and `failed`; reject activation from `refreshing` as already running; return no-op success from `online`.
- [x] 4.7 Add a persistent KV projection listener that subscribes to `SEGMENT_COMMITTED` after the projection is online.
- [x] 4.8 Apply retained KV mutations from committed event records only after the segment commit completes.
- [x] 4.9 Ignore non-retained events for KV projection updates.
- [x] 4.10 Persist `current_position` after each committed event is inspected or applied during activation.
- [x] 4.11 Keep `Realm.registerKeyValueEngine()` as the local/in-memory compatibility path, not the persistent distributed KV registration mechanism.
- [x] 4.12 Add a reset command that clears projected KV data, sets `current_position = NULL`, clears `last_error`, and sets status to `inactive`.
- [x] 4.13 Advance `current_position` for every online KV projection on each `SEGMENT_COMMITTED`, using the committed segment ID when no later matching event ID is applied.
- [x] 4.14 Select projection targets by `opt.retain === true`, the event realm's registry table, and matching `uri_pattern`.
- [x] 4.15 Apply one retained event to every matching projection, not just the first match.
- [x] 4.16 Validate projected values against the matching schema when a schema exists for the accepted URL.
- [x] 4.17 Delete projected retained rows when `isDataEmpty(event.data)` is true, including MQTT empty-payload publishes mapped to `null`.

## 5. Verification

- [x] 5.1 Create `test/56.kv_registry.ts` to test registration and lifecycle.
- [x] 5.2 Verify that `current_position` stores text event/segment watermarks and tracks the last inspected or reached committed position.
- [x] 5.3 Verify that `SEGMENT_COMMITTED` includes committed event records with assigned event IDs.
- [x] 5.4 Verify retained KV state is updated by the committed-segment listener, not by pre-commit save/update hooks.
- [x] 5.5 Verify non-retained events do not change projected KV state, while committed segments may still advance the projection `current_position` watermark.
- [x] 5.6 Verify a newly registered projection remains `inactive` until the activation command runs.
- [x] 5.7 Verify activation moves through `refreshing` to `online` after historical catch-up reaches the realm-scoped activation target.
- [x] 5.8 Verify activation failure sets `failed` and records `last_error`.
- [x] 5.9 Verify activation target selection uses the latest committed event ID for the projection realm when a segment contains events for multiple realms.
- [x] 5.10 Verify committed event IDs are built as `<string-segment-id><string-event-offset>`, where `<string-event-offset>` is produced by `keyId(id: number)`.
- [x] 5.11 Verify activation and catch-up compare event IDs with string comparison, without parsing event IDs into segment and offset parts.
- [x] 5.12 Verify reset clears projected KV data, clears `current_position` and `last_error`, and leaves the projection `inactive` until activation is requested.
- [x] 5.13 Verify activation status handling: `inactive` and `failed` start refresh, `refreshing` rejects as already running, and `online` returns no-op success.
- [x] 5.14 Verify empty-realm activation sets status to `online` with `current_position = NULL`.
- [x] 5.15 Verify each `SEGMENT_COMMITTED` advances `current_position` for all online KV projections, even when a projection has no matching KV mutation in that segment.
- [x] 5.16 Verify committed segment IDs compare greater than previous message IDs and segment IDs by string comparison.
- [x] 5.17 Verify a retained event is stored in all matching projections and no non-matching projections.
- [x] 5.18 Verify schema validation runs before projected retained values are stored.
- [x] 5.19 Verify `null` from MQTT empty retained payload deletes the projected retained row.
