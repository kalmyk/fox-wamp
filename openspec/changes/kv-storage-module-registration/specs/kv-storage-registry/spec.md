## ADDED Requirements

### Requirement: KV Storage Registration
The system SHALL maintain a registry of all available key-value storage modules to manage their lifecycle and synchronization.

#### Scenario: Registering a new storage
- **WHEN** a KV storage module is initialized for the first time
- **THEN** the system SHALL create a record in the `kv_storages` table with its `name`, `uri_pattern`, and initial `status` as `inactive`.

### Requirement: Storage Lifecycle Status
The system SHALL track the operational state of each registered KV storage module.

#### Scenario: Transitioning to refreshing
- **WHEN** a storage module starts its synchronization or data load process
- **THEN** the system SHALL update its status to `refreshing` and record the current timestamp in `started_at`.

#### Scenario: Transitioning to online
- **WHEN** a storage module completes synchronization and is ready to serve requests
- **THEN** the system SHALL update its status to `online`.

### Requirement: Message Position Tracking
The system SHALL persist the last successfully processed message ID for each storage module to enable resume capability.

#### Scenario: Updating processed position
- **WHEN** a storage module successfully processes a message with ID `N`
- **THEN** the system SHALL update the `current_position` in the registry for that storage to `N`.
