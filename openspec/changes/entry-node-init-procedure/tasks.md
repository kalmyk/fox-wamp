## 1. Protocol and Message Types

- [x] 1.1 Add  `INIT_ENTRY_ACCEPTED` to `Event` enum in `lib/masterfree/hyper.h.ts`.
- [x] 1.2 Define `BODY_INIT_ENTRY_ACCEPTED` in `lib/masterfree/hyper.h.ts`.

## 2. Sync Node Implementation

- [x] 2.1 Implement `event_init_entry` in `StageOneTask` class within `lib/masterfree/synchronizer.ts`.

## 3. Entry Node Implementation

- [x] 3.1 Update `NetEngineMill` in `lib/masterfree/netengine.ts` to include initialization state and quorum tracking.
- [x] 3.2 Update `masterfree/entry.ts` to call the new initialization procedure and connect to sync nodes.

## 4. Verification and Testing

- [x] 4.1 Update tests in `test/62.synchronizer.ts` to verify the handshake logic on sync node.
- [/] 4.2 Handshake logic on entry node verified in `test/61.net_entry.ts` (partial coverage).
- [ ] 4.3 Create `test/64.net_init.ts` to fully verify handshake quorum and maxAdvanceId calculation (as originally planned).
- [x] 4.4 Test successful initialization with quorum (in 61.net_entry.ts).
- [ ] 4.5 Test initialization waiting behavior when quorum is not reached.
- [x] 4.6 Verify `maxAdvanceId` calculation with alphanumeric IDs (N/A - changed to numeric format in 5.1).

## 5. Bug Fixes and Improvements

- [x] 5.1 Fix `computeMaxId` by changing `advanceSegment` to a numeric format and using composite keys for uniqueness.
- [ ] 5.2 Implement timeout for `init-entry` handshake in `NetEngineMill`.
