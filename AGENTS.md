# Code Understanding

## Project Overview

This project is a **Web Application Message Server** written in Node.js. It acts as a message router that supports both the **WAMP (Web Application Messaging Protocol)** and **MQTT** protocols. This allows for interoperability between different messaging clients. For example, an event can be sent through an MQTT interface and handled by a WAMP client.

The server is built to be extensible, with a pluggable interface for different message protocols. It also includes features like retained storage, event filtering, and a synchronization service.

The project is migrating from JavaScript to TypeScript.

## OpenSpec Support
This project uses **OpenSpec** for specification-driven development.
- **Project Specification:** Detailed project context, tech stack, and conventions are maintained in `openspec/project.md`. This file serves as the primary source of truth for agents and developers.
- **Change Management:** New features and complex fixes should be proposed as OpenSpec changes in the `openspec/changes/` directory.

## Building and Running

### Installation

```bash
npm install
```

### Compilation

To compile the TypeScript code, run:

```bash
npm run compile
```

This will output the compiled JavaScript files to the `out` directory.

### Testing

To run the tests, which include linting and mocha tests, run:

```bash
npm test
```

### Running the Server

The `bin` directory contains several scripts for running the server in different configurations. For example, to run the basic server:

```bash
node bin/basic.js
```

To run the server with a MQTT gate:

```bash
node bin/mqtt_gate.js
```

## Development Conventions

### Linting

The project uses ESLint for linting. To run the linter, use:

```bash
npm run lint
```

### Code Style

The project uses the `gts` (Google TypeScript Style) for code style. Do not use semicolons to terminate statements if possible.

### Testing

The project uses `mocha` and `chai` for testing. Test files are located in the `test` directory and have the `.mjs` extension. Use `npm test` for testing.

# AI Task List
## Tasks To Do:

### Task 1: Update Documentation
*   **Status:** Pending
*   **Description:** Review `README.md` files. Ensure all steps for local setup and development are accurate and up-to-date. Pay special attention to the new authentication flow.
*   **Priority:** Low
*   **Deadline:** no
