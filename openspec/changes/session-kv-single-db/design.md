## Context

The project supports a "will" attribute in WAMP/MQTT publish messages, which specifies a value to be set for a key when the publishing session disconnects. This is currently implemented in-memory via `MemKeyValueStorage`. In Single DB (SQLite) mode, `SqliteKvFabric` has a placeholder table `set_value_${realmName}` that is intended for this purpose but is currently unused and has an incomplete schema.

## Goals / Non-Goals

**Goals:**
- Provide persistent storage for on-disconnect KV updates in Single DB mode.
- Maintain feature parity with the in-memory implementation.
- Enable debugging by tracking the originating message ID for each pending update.

**Non-Goals:**
- Implementing cluster-wide session synchronization (this change is specific to Single DB mode).
- Modifying the WAMP/MQTT protocol handlers.
- Modifying the `NetEngine` or any distributed state synchronization logic.

## Decisions

### 1. Table Schema and Name
- **Decision**: Rename `set_value_${realmName}` to `session_kv_${realmName}`.
- **Rationale**: `session_kv` more clearly describes the purpose (KV data tied to a session).
- **Structure**:
  ```sql
  CREATE TABLE session_kv_${realmName} (
    key TEXT not null,
    value TEXT not null,
    will_sid TEXT not null,
    msg_id TEXT not null,
    PRIMARY KEY (key)
  );
  ```
- **Rationale**: Using `key` as the primary key enforces the "Last session wins" rule. Any new publish to a key (even from a different session) will overwrite or clear the previous "will" registration for that key, matching the In-Memory behavior.

### 2. Implementation in `SqliteKvFabric`

#### **A. Optimistic Locking and Waiting (`when` / `watch`)**
- **Decision**: Use a transient in-memory map `resWhen: Map<string, Actor[]>` to track sessions waiting for a key condition.
- **Rationale**: `watch` conditions are tied to active socket connections and do not need to persist across router restarts.
- **Logic**:
  1. Read current value from `kv` table.
  2. If `when` is provided:
     - Check `isDataFit(when, oldData)`.
     - If it matches: Proceed to update.
     - If it doesn't match and `watch` is true: Add actor to `resWhen` map and **defer** acknowledgment.
     - If it doesn't match and `watch` is false: Reject immediately.
  3. After any successful update to a key:
     - Check `resWhen` for that key.
     - Re-evaluate each parked actor. If their `when` now matches, apply their update recursively and confirm.

#### **B. Session Disconnect (`eraseSessionData`)**
- This method is called when a session terminates. It will:
  1. Cleanup any pending `watch` actors from the `resWhen` map for that session.
  2. Query `session_kv` for all records matching the `sessionId`.
  3. For each record, call `runInboundEvent` with the stored `value`.
  4. Delete the applied records from `session_kv`.

#### **C. Publish with Will (`setKeyValue`)**
- On every successful publish (not just those with `will`):
  1. `DELETE FROM session_kv WHERE key = ?` to clear any previous session's "will" for this key.
  2. If `opt.will` is present in the new publish, `INSERT` the new will into `session_kv`.
- **Rationale**: This ensures that if the value of a key is changed by *any* process, the previous `will` value is cleaned, as per the specifications.

### 3. Handling Unused Table
- **Decision**: Drop the existing `set_value_${realmName}` table and create the new one.
- **Rationale**: Since the table is currently unused and its schema is incompatible with the new requirements, dropping and recreating is simpler and safer than attempting an `ALTER TABLE` sequence.

### 4. Startup Recovery (Stale Record Processing)
- **Decision**: On router startup (specifically during `launchEngine`), scan the `session_kv_${realmName}` table for any existing records.
- **Rationale**: In Single DB mode, any records found at startup belong to sessions from a previous run that were not cleaned up (likely due to a crash).
- **Process**:
  1. Retrieve all records from `session_kv`.
  2. For each record, call `runInboundEvent` with the stored value, using the original `will_sid`.
  3. These are processed as **regular events** (no special "Stale" flag).
  4. Delete the records from `session_kv` after they are applied.

## Risks / Trade-offs

- **[Risk]** Data loss for "will" updates if the router crashes and restarts.
- **Mitigation**: The updates are stored in SQLite and will be automatically applied during the next **Startup Recovery** phase.
- **[Trade-off]** Extra database write on every publish with a `will` attribute.
- **Mitigation**: This is necessary for persistence and is expected in persistent storage modes.
- **[Trade-off]** Divergence from In-Memory behavior.
- **Mitigation**: SQLite mode allows multiple sessions to have active wills for the same key (last disconnect wins), whereas In-Memory only tracks the `will_sid` of the last publisher. This is accepted as a robustness improvement in persistent mode.

## Open Questions

1. **Graceful Disconnect vs. Crash**: Should a graceful MQTT `DISCONNECT` (which usually cancels the LWT) also cancel the KV-specific wills? Currently, `eraseSessionData` fires on all session leaves.
2. **Advanced Parity**: Should we add a `condition` column to `session_kv` now to support the `when`/`watch` attributes found in `MemKeyValueStorage` later?
3. **Recovery Timing**: Should recovery happen strictly *after* the main KV tables are initialized but *before* new sessions are allowed to join? (Current plan: yes).
