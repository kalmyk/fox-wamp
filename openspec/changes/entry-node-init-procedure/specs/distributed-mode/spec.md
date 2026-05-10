## ADDED Requirements

### Requirement: Distributed Initialization Phase
The distributed system lifecycle MUST include an explicit initialization phase for storage nodes (NDB) to ensure cluster-wide consistency.

#### Scenario: Initialization Before Message Flow
- **WHEN** a cluster is booting up
- **THEN** all NDB nodes SHALL complete their `ndb-initialization` handshake before they are considered valid targets for `KEEP_ADVANCE_HISTORY` or `TRIM_ADVANCE_SEGMENT` operations.
