## 1. Protocol and Message Types

- [x] 1.1 Add `INIT_ENTRY` and `INIT_ENTRY_ACCEPTED` to `Event` enum in `lib/masterfree/hyper.h.ts`.
- [x] 1.2 Define `BODY_INIT_ENTRY` and `BODY_INIT_ENTRY_ACCEPTED` in `lib/masterfree/hyper.h.ts`.

## 2. Sync Node Implementation

- [x] 2.1 Implement `event_init_entry` in `StageOneTask` class within `lib/masterfree/synchronizer.ts`.
- [x] 2.2 Register `INIT_ENTRY` subscription in `StageOneTask` constructor.

## 3. Entry Node Implementation

- [x] 3.1 Update `NetEngineMill` in `lib/masterfree/netengine.ts` to include initialization state and quorum tracking.
- [x] 3.2 Implement `initHandshake` method in `NetEngineMill` to send `INIT_ENTRY` and wait for responses.
- [x] 3.3 Implement `listenSync` in `NetEngineMill` to pipe events.
- [x] 3.4 Update `masterfree/entry.ts` to call the new initialization procedure and connect to sync nodes.
- [x] 3.5 Remove obsolete `initHandshake` from `StorageTask` and `masterfree/ndb.ts`.

## 4. Verification and Testing

- [x] 4.1 Update tests in `test/62.synchronizer.ts` to verify the handshake logic on sync node.
- [x] 4.2 Create `test/64.net_init.ts` to verify the handshake logic on entry node.
- [x] 4.3 Test successful initialization with quorum.
- [x] 4.4 Test initialization waiting behavior when quorum is not reached.
- [x] 4.5 Verify `maxAdvanceId` calculation in entry node.
