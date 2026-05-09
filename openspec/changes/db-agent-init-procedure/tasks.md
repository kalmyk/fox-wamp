## 1. Protocol and Message Types

- [x] 1.1 Add `INIT_DB` and `INIT_DB_ACCEPTED` to `Event` enum in `lib/masterfree/hyper.h.ts`.
- [x] 1.2 Define `BODY_INIT_DB` and `BODY_INIT_DB_ACCEPTED` in `lib/masterfree/hyper.h.ts`.

## 2. Sync Node Implementation

- [x] 2.1 Implement `event_init_db` in `StageOneTask` class within `lib/masterfree/synchronizer.ts`.
- [x] 2.2 Register `INIT_DB` subscription in `StageOneTask` constructor.

## 3. NDB Node Implementation

- [x] 3.1 Update `StorageTask` in `lib/masterfree/storage.ts` to include initialization state and quorum tracking.
- [x] 3.2 Implement `initHandshake` method in `StorageTask` to send `INIT_DB` and wait for responses.
- [x] 3.3 Ensure `StorageTask` blocks or queues messages until initialization quorum is reached. (ndb startup now waits for handshake before attaching gates)
- [x] 3.4 Update `masterfree/ndb.ts` to call the new initialization procedure.

## 4. Verification and Testing

- [x] 4.1 Create a new tests in existing file `test/62.synchronizer.ts` to verify the handshake logic on sync node.
- [x] 4.2 Create a new tests in existing file `test/63.storage.ts` to verify the handshake logic on storage node.
- [x] 4.3 Test successful initialization with quorum.
- [ ] 4.4 Test initialization waiting behavior when quorum is not reached.
- [x] 4.5 Verify `maxAdvanceId` calculation in NDB.
