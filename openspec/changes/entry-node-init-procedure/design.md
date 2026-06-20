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

- **Passive Handshake**: Entry nodes wait for `INIT_ENTRY_ACCEPTED` responses from connecting Sync nodes instead of sending an outbound `INIT_ENTRY` request.
- **New Message Types**:
  - `Event.INIT_ENTRY_ACCEPTED`: Sent by Sync nodes back to the entry node upon connection.
- **Protocol Extension**: Update `lib/masterfree/hyper.h.ts` with these events and their body types.
- **Sync Node Logic**: Update `listenEntry` to immediately publish `INIT_ENTRY_ACCEPTED` to the entry node upon connection.
- **Entry Node Logic**:
  - Start the FOX server (passive listener) *before* entering the initialization wait state in `masterfree/entry.ts`.
  - `NetEngineMill.initHandshake` subscribes to `INIT_ENTRY_ACCEPTED.<myNodeId>` and waits until `syncQuorum` responses are received.
- **Quorum Tracking**: Entry node maintains a set of responding Sync nodes and a list of received `advance-ids`. Once the set size reaches `syncQuorum`, it calculates the `maxAdvanceId` and transitions to ready.
 - **ID Format**: `advanceStamp` is a number (timestamp in msec). Uniqueness in shared components (Sync/Storage) is maintained by using a composite key `advanceOwner:advanceStamp`.
 - **Timeout**: `NetEngineMill` should implement a timeout (default 30s) for the handshake to prevent the entry node from hanging indefinitely if quorum cannot be reached.

## Risks / Trade-offs

- **[Risk]** Entry node never reaches quorum if too many Sync nodes are down.
- **[Mitigation]** The system already requires `syncQuorum` for normal operation; initialization failure correctly reflects cluster unavailability. A timeout should be added to notify the operator.
- **[Trade-off]** Using numeric segment IDs simplifies parsing in `computeMaxId` but requires shared components to track `advanceOwner` to avoid collisions.
