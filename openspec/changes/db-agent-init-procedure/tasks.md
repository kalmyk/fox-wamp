## 1. Protocol and Message Types

- [ ] 1.1 Add `INIT_DB` and `INIT_DB_ACCEPTED` to `Event` enum in `lib/masterfree/hyper.h.ts`.
- [ ] 1.2 Define `BODY_INIT_DB` and `BODY_INIT_DB_ACCEPTED` in `lib/masterfree/hyper.h.ts`.

## 2. Sync Node Implementation

- [ ] 2.1 Implement `event_init_db` in `StageOneTask` class within `lib/masterfree/synchronizer.ts`.
- [ ] 2.2 Register `INIT_DB` subscription in `StageOneTask` constructor.

## 3. NDB Node Implementation

- [ ] 3.1 Update `StorageTask` in `lib/masterfree/storage.ts` to include initialization state and quorum tracking.
- [ ] 3.2 Implement `initHandshake` method in `StorageTask` to send `INIT_DB` and wait for responses.
- [ ] 3.3 Ensure `StorageTask` blocks or queues messages until initialization quorum is reached.
- [ ] 3.4 Update `masterfree/ndb.ts` to call the new initialization procedure.

## 4. Verification and Testing

- [ ] 4.1 Create a new tests in file `test/62.synchronizer.ts` to verify the handshake logic on sync node.
- [ ] 4.2 Create a new tests in file `test/63.storage.ts` to verify the handshake logic on storage node.
- [ ] 4.3 Test successful initialization with quorum.
- [ ] 4.4 Test initialization waiting behavior when quorum is not reached.
- [ ] 4.5 Verify `maxAdvanceId` calculation in NDB.
