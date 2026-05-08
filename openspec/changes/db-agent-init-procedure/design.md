## Context

NDB (database) nodes currently start serving queries immediately upon connection to the Sync cluster, without ensuring they have the most recent state. This can lead to inconsistencies. A quorum-based initialization handshake is required.

## Goals / Non-Goals

**Goals:**
- Implement a handshake where NDB nodes send `init-db` and wait for `syncQuorum` responses.
- Sync nodes must respond with their `last seen advance-id` of that NDB node.
- NDB nodes must establish the maximum `advance-id` from responses to align their state.
- NDB nodes must block or delay query processing until initialization is successful.

**Non-Goals:**
- Full historical data synchronization (this handshake only establishes the "recent" point).
- Handling persistent failure of Sync nodes (init will simply wait).

## Decisions

- **New Message Types**:
  - `Event.INIT_DB`: Sent by NDB to all Sync nodes.
  - `Event.INIT_DB_ACCEPTED`: Sent by Sync nodes back to the NDB node.
- **Protocol Extension**: Update `lib/masterfree/hyper.h.ts` with these events and their body types.
- **Sync Node Logic**: Add `event_init_db` handler to `StageOneTask` in `lib/masterfree/synchronizer.ts`. It will publish `INIT_DB_ACCEPTED` to a node-specific topic (e.g., `INIT_DB_ACCEPTED.<nodeId>`).
- **NDB Logic**:
  - Add an `init()` method to `StorageTask` or create a new `InitTask` in `lib/masterfree/storage.ts`.
  - The `StorageTask` (which handles NDB storage) seems the most appropriate place as it already has access to the database and realm.
  - NDB will subscribe to `INIT_DB_ACCEPTED.<myNodeId>` before sending `INIT_DB`.
- **Quorum Tracking**: NDB will maintain a set of responding Sync nodes and a list of received `advance-ids`. Once the set size reaches `syncQuorum`, it calculates the `maxAdvanceId` and transitions to ready.

## Risks / Trade-offs

- **[Risk]** NDB never reaches quorum if too many Sync nodes are down.
- **[Mitigation]** The system already requires `syncQuorum` for normal operation; initialization failure correctly reflects cluster unavailability.
- **[Trade-off]** Using a dedicated queue/topic for responses ensures the NDB node only sees its own init confirmations, but adds complexity to topic management.
