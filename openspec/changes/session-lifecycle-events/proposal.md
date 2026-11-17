# Proposal

## Why

In distributed mode, the cluster has no ordered record of when a client session starts or ends. A session's end is only a local callback on its entry node, and an entry crash produces no signal at all. Any replicated per-session state, starting with KV wills and wait-for-lock waiters (`kv-when-replicated-waiters`), needs to know at a precise point in the global event order that a session is gone. Every replica has to agree on that point, including when the entry itself has failed.

## What Changes

- **`SESSION_JOIN` / `SESSION_LEAVE` as history events.**
  - When a client joins an entry realm, the entry emits `SESSION_JOIN{entryId, realm, sid}`. On a normal disconnect it emits `SESSION_LEAVE{entryId, realm, sid}`.
  - Both go through the regular segment pipeline. Sync voting assigns the event id, and the event is saved to event history.
  - Consumers such as KV nodes apply them when present. The id is assigned whether or not any consumer exists.
  - These events are never dispatched to client subscribers.
- **Sync nodes keep a live-session set per entry.**
  - Entries also send JOIN/LEAVE bodies to every sync node.
  - A sync node adds a sid when its JOIN's segment resolves and removes it when its LEAVE's segment resolves. A JOIN in a segment that never resolves never existed.
  - When a sync node connects to an entry, the entry sends a session snapshot. While the entry is alive, it is the source of truth for its sessions.
- **Detecting a lost entry.**
  - When a sync node loses its connection to an entry, it proposes `DETECTED_SESSION_LEAVE` to its peer sync nodes: one synthetic segment on behalf of the lost entry, holding a `SESSION_LEAVE` for every sid in its set.
  - Peers vote on it as they do on regular segments. Proposals are deduplicated by `(entryId, stamp)`, and the batch is the union of the proposers' sets.
  - A peer that still has a live connection to the entry refuses to vote, so a LEAVE batch needs a quorum that has lost the entry.
  - The committed LEAVEs are saved to history and consumed like normal LEAVEs.
- **Committed history overrides the entry.**
  - An entry that sees a committed `SESSION_LEAVE` for one of its sids still connected locally SHALL disconnect that session. This covers partitions, false-positive detection and stale sync sets the same way.
  - Consumers SHALL ignore or reject any event from `(entryId, sid)` that comes after that sid's committed LEAVE in event order.
- **BREAKING (sync invariants):** sync nodes are no longer stateless. They hold one bounded live-session set per connected entry, on top of per-advance voting entries.

## Capabilities

### New Capabilities
- `session-lifecycle`: session join/leave as voted history events, sync-side live-session tracking and entry snapshots, detection of a lost entry and the voted synthetic LEAVE batch, and the rule that committed LEAVEs override the entry's local view (forced disconnect, and consumers rejecting events after LEAVE).

### Modified Capabilities
- `distributed-mode`: the message lifecycle gains session events, and sync's stateless-voting invariants ("no heap accumulation") change to allow bounded per-entry session sets. The sync↔entry protocol gains the session snapshot on connect, and sync nodes can propose segments on behalf of a lost entry.

## Impact

- **Code:**
  - `lib/masterfree/netengine.ts`: emit JOIN/LEAVE, send the snapshot to sync, disconnect sessions on a committed LEAVE.
  - `lib/masterfree/synchronizer.ts`: session sets, failure detection, synthetic-segment proposal and vote refusal while the entry is still visible.
  - `bin/masterfree/sync.ts`: connection-loss handling for each entry link.
  - `lib/masterfree/hyper.h.ts`: new event names and bodies.
  - `lib/masterfree/storage.ts`: accepts history bodies for a synthetic segment that sync proposed, not the entry.
- **Wire protocol:** new events `SESSION_JOIN`, `SESSION_LEAVE`, `DETECTED_SESSION_LEAVE` and the session snapshot, plus the vote-refusal condition in StageOne.
- **Dependents:** `kv-when-replicated-waiters` will replace its `SESSION_CLOSED` / `ENTRY_RESET` events with this capability.
- **Dependencies:** consumers that apply LEAVE in global order (KV nodes) rely on the cross-shard ordering from `live-dispatch-eventid-ordering`. The voting and history parts of this change do not.
- **Open items for design:**
  - which node supplies the history bodies of the synthetic LEAVE segment to storage;
  - how an entry learns about LEAVEs committed while it was partitioned (history catch-up vs. a hint in `INIT_ENTRY_ACCEPTED`), and whether conditional publishes are held back until then;
  - the detection timeout and its configuration.
