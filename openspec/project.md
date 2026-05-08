# Project: FOX-WAMP

## Overview
FOX-WAMP is a Web Application Message Router/Server that supports both WAMP (Web Application Messaging Protocol) V2 Basic Profile and MQTT 3.1. It provides durable message sourcing for web applications and allows interoperability between different messaging protocols.

## Router Modes
FOX-WAMP supports several operational modes depending on the storage and distribution requirements:

### 1. In-Memory Mode
- **Storage:** Uses `MemEngine` and `MemKeyValueStorage`.
- **Characteristics:** Fast, non-persistent. All state (retained messages, subscriptions, etc.) is lost when the process restarts.
- **Default:** Used by the standard `FoxRouter` (as seen in `bin/basic.js`).

### 2. Local SQLite Mode (Single Database)
- **Storage:** Uses `OneDbRouter` with a local SQLite database file.
- **Characteristics:** Persistent. Retained messages and event history are stored in SQLite.
- **Components:** `DbFactory`, `SqliteKv`, and `History` modules manage the database interactions.
- **Usage:** Demonstrated in `bin/singledb.js`.

### 3. Distributed Mode (Masterfree)
- **Storage:** Distributed state synchronization with SQLite backend on data nodes.
- **Characteristics:** High availability and scalability. State is synchronized across multiple nodes in a "masterfree" architecture.
- **Detailed Specification:** See [Distributed Mode](specs/distributed-mode.md) for architecture, message flow diagrams, and ID election protocols.
- **Components:**
    - `NetEngine`: Handles inter-node communication and state replication.
    - `entry.ts`: Gateway node that handles client connections (WAMP/MQTT).
    - `ndb.ts`: Data/Storage node that manages persistent state via SQLite and synchronizes with other nodes.
    - `synchronizer.ts`: Manages cluster-wide state consistency.
- **Communication:** Uses a internal queue-based protocol over `HyperNet` for node-to-node synchronization.

## Tech Stack
- **Language:** TypeScript (Source in `lib/`, `bin/`, `masterfree/`, `test/`). The project is actively migrating from JavaScript to TypeScript.
- **Runtime:** Node.js (>= 8.5.0)
- **Protocols:** WAMP V2, MQTT 3.1
- **Databases/Storage:** SQLite (via `sqlite`, `sqlite3` packages)
- **Key Libraries:**
    - `ws`: WebSocket communication
    - `mqtt-packet`: MQTT protocol handling
    - `msgpack-lite`: Binary serialization
    - `qlobber`: Topic matching
    - `commander`: CLI tool building
    - `jsonschema`: Message validation
    - `prom-client`: Prometheus metrics

## Coding Conventions
- **Style Guide:** Based on Google TypeScript Style (GTS).
- **Indentation:** 2 spaces.
- **Semicolons:** Do NOT use semicolons to terminate statements unless strictly necessary for syntax (e.g., in some edge cases with leading brackets).
- **Line Endings:** Unix (LF).
- **Modules:** ES6 modules for TypeScript source.

## Testing
- **Framework:** Mocha
- **Assertion Library:** Chai (with `chai-as-promised` and `chai-spies`)
- **Execution:** `npm test` runs linting, build, and then mocha tests.
- **Test Location:** `test/` directory.

## Domain Knowledge
- **Message Routing:** Pub/Sub and RPC (Remote Procedure Call) patterns.
- **Topic Translation:** MQTT topics (`app/topic/name`) are automatically translated to WAMP topics (`app.topic.name`).
- **Retained Storage:** Supports keeping the last content of a published message.
- **Synchronization Service:** Provides locking mechanisms (mutex) using WAMP/MQTT primitives.
- **Event Filtering:** Server-side filtering of messages based on subscription options.
- **Aggregate Engine:** Materialized views gathered on event streams, defined via JSON schema.

## Build & Run
- **Build:** `npm run build` (runs `tsc`).
- **Lint:** `npm run lint` (runs `eslint`).
- **Run Basic Server:** `node bin/basic.js`
- **Docker:** `docker build -t fox-wamp . --file=./docker/Dockerfile`
