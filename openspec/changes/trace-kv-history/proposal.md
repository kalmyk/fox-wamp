## Why

Currently, update history is partially implemented for Key-Value (KV) storage, but it lacks a formal specification and does not cover other persistent entities like message schemas. To ensure auditability, debugging, and the ability to trace the evolution of data and schemas within a realm, a unified history tracking mechanism is needed.

## What Changes

- Formalize the `update_history_${realmName}` table as the single source of truth for tracking changes to persistent entities.
- Ensure all Key-Value (KV) updates record their prior state, the originating message/event ID, and a stable update ID.
- Extend history tracking to message schema lifecycle events (registration, activation, deactivation).
- Standardize the `update_history` record format with explicit entity type, old value, and new value fields.
- Provide a consistent API for querying the history of a specific entity or the entire realm.

## Capabilities

### New Capabilities

- `unified-update-history`: Centralized history tracking for persistent entities. This capability defines the schema and recording logic for the `update_history_${realmName}` table.

### Modified Capabilities

- `session-persistent-kv`: Formally require history logging for every KV change, including session-deferred updates.
- `schema-repository`: Require logging of schema registration and status changes to the unified history table.

## Impact

- `lib/sqlite/sqlitekv.ts`: Refactor existing history logic to align with the new unified format.
- `lib/sqlite/schema_repository.ts` (pending implementation): Integrate history logging for schema lifecycle events.
- Database Schema: Standardize `update_history_${realmName}` to include explicit `entity_type` and `action` fields so KV changes and schema lifecycle events are unambiguous.
- Testing: Add comprehensive tests for history recording across different storage modules.
