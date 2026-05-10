## Context

Entry nodes currently start serving queries immediately upon startup, without ensuring they have the most recent state or are correctly aligned with the Sync cluster. This can lead to inconsistencies. A quorum-based initialization handshake is required.

## Goals / Non-Goals

**Goals:**
- Implement a handshake where entry nodes send `INIT_ENTRY` and wait for `syncQuorum` responses.
- Sync nodes must respond with their `last seen advance-id` of that entry node.
- Entry nodes must establish the maximum `advance-id` from responses to align their state.
- Entry nodes must block or delay starting their listener servers until initialization is successful.

**Non-Goals:**
- Full historical data synchronization.
- Handling persistent failure of Sync nodes (init will simply wait or timeout).

## Decisions

- **New Message Types**:
  - `Event.INIT_ENTRY`: Sent by entry node to all Sync nodes.
  - `Event.INIT_ENTRY_ACCEPTED`: Sent by Sync nodes back to the entry node.
- **Protocol Extension**: Update `lib/masterfree/hyper.h.ts` with these events and their body types.
- **Sync Node Logic**: Add `event_init_entry` handler to `StageOneTask` in `lib/masterfree/synchronizer.ts`. It will publish `INIT_ENTRY_ACCEPTED` to a node-specific topic (e.g., `INIT_ENTRY_ACCEPTED.<nodeId>`).
- **Entry Node Logic**:
  - Add `initHandshake` and `listenSync` methods to `NetEngineMill` in `lib/masterfree/netengine.ts`.
  - Entry node will subscribe to `INIT_ENTRY_ACCEPTED.<myNodeId>` before sending `INIT_ENTRY`.
- **Quorum Tracking**: Entry node will maintain a set of responding Sync nodes and a list of received `advance-ids`. Once the set size reaches `syncQuorum`, it calculates the `maxAdvanceId` and transitions to ready.
 - **Sync Node Logic (implemented)**: `StageOneTask` subscribes to `INIT_ENTRY` and responds with `INIT_ENTRY_ACCEPTED.<nodeId>` containing `lastSeenAdvanceId`.
 - **Entry Node Logic (implemented)**:
   - `NetEngineMill.initHandshake(syncQuorum, timeoutMs=30000)` was added to `lib/masterfree/netengine.ts`.
   - The NetEngineMill subscribes to `INIT_ENTRY_ACCEPTED.<myNodeId>`, publishes `INIT_ENTRY`, collects unique responses until `syncQuorum`, computes `maxAdvanceId`, and resolves.
   - The entry startup sequence (masterfree/entry.ts) now waits for the handshake to resolve before starting servers.

## Risks / Trade-offs

- **[Risk]** Entry node never reaches quorum if too many Sync nodes are down.
- **[Mitigation]** The system already requires `syncQuorum` for normal operation; initialization failure correctly reflects cluster unavailability.
- **[Trade-off]** Using a dedicated queue/topic for responses ensures the entry node only sees its own init confirmations.
