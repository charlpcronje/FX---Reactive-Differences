# FXDif - Reactive Folder Differences Tool

## Project Overview

The project is a Deno-based command-line tool called `FXDif` that allows users to compare multiple folders and track file differences. It provides both a terminal user interface (TUI) and a web-based interface. The TUI is built using the `cliffy` library, and the web interface is powered by `Hono`. The project uses a SQLite database to store project information, including the folders to be compared and any filtering rules.

The core functionality is in the `src/core` directory, which contains the `FolderComparator` and `FileScanner` classes. The `FileScanner` is responsible for scanning the file system and applying filtering rules, while the `FolderComparator` compares the scanned files and identifies differences.

The CLI commands are parsed in `src/cli/parser.ts` and handled in `src/cli/handlers.ts`. The TUI is rendered by the `TUIViewer` class in `src/tui/viewer.ts`. The web server, defined in `src/web/server.ts`, provides a REST API for interacting with the tool's functionality.

## Building and Running

### Development

To run the application in development mode, use the following command:

```bash
deno task dev
```

### Compilation

To compile the application into a single executable, use the following command:

```bash
deno task compile
```

To compile the application for Windows, use the following command:

```bash
deno task compile:windows
```

### Web Interface

To start the web server, use the following command:

```bash
fxdif --host
```

The web interface will be available at `http://localhost:8000`.

## Development Conventions

*   **Code Style:** The code is written in TypeScript and follows the standard Deno formatting conventions.
*   **Testing:** There are no explicit tests in the project.
*   **Dependencies:** Dependencies are managed in the `deno.json` file.
*   **Database:** The project uses a SQLite database, and the schema is defined in `src/db/schema.ts`. The database interactions are encapsulated in repository classes (`ProjectRepository`, `RuleRepository`).
*   **Modularity:** The code is well-structured and modular, with clear separation of concerns between the core logic, CLI, TUI, and web components.
