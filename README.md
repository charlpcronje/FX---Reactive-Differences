# FXDif - Reactive Folder Differences Tool

An innovative TUI and web-based tool for comparing multiple folders and tracking file differences across project instances.

## Features

- 🔍 **Multi-folder comparison** - Compare any number of folders against a base directory
- 📊 **Project management** - Save and manage multiple comparison projects
- 🎨 **Dual interfaces** - Beautiful TUI and web UI
- 🎯 **Smart filtering** - Include/exclude specific file extensions and files
- ⚡ **Real-time diffing** - Fast file comparison with visual indicators
- 🗃️ **Soft deletes** - Non-destructive project and folder management
- ⌨️ **Keyboard shortcuts** - Efficient navigation and controls

## Installation

### Prerequisites
- Deno 2.0+ installed ([https://deno.land](https://deno.land))

### Compile from Source

```bash
# Clone the repository
git clone <repository-url>
cd FX---Reactive-Differences

# Compile for Windows
deno task compile:windows

# The executable will be in dist/fxdif.exe
```

### Add to PATH (Windows)

1. Copy `dist/fxdif.exe` to a permanent location (e.g., `C:\Tools\fxdif.exe`)
2. Add that directory to your PATH:
   - Press Win + X, select "System"
   - Click "Advanced system settings"
   - Click "Environment Variables"
   - Under "User variables", select "Path" and click "Edit"
   - Click "New" and add your directory path
   - Click OK on all dialogs
3. Open a new terminal and type `fxdif` from anywhere!

## Usage

### Creating a New Project

```bash
# Run in a folder to create a new project
fxdif
```

This will:
- Prompt for a project name (defaults to current folder name)
- Ask for a project code (defaults to project name)
- Create the project with the current folder as the base

### Adding Folders to Compare

```bash
# Add current folder to an existing project
fxdif PROJECT_CODE+

# Example
cd C:\dev\myproject-copy
fxdif myproject+
```

### Removing Folders

```bash
# Remove current folder from project
fxdif PROJECT_CODE-

# Remove from sub-folder (excludes only that sub-folder)
cd C:\dev\myproject\src
fxdif myproject-
```

### File Extension Filtering

```bash
# Include only specific extensions (global)
fxdif PROJECT_CODE .php+ .js+ .ts+

# Exclude specific extensions (global)
fxdif PROJECT_CODE .php- .go-

# Include/exclude in specific folder (folder-specific)
cd C:\dev\myproject\src
fxdif PROJECT_CODE .test.js-
```

### Specific File Rules

```bash
# Exclude specific file globally
fxdif PROJECT_CODE config.php-

# Include specific file even if folder is excluded
fxdif PROJECT_CODE important.js+
```

### Web Interface

```bash
# Start web server
fxdif --host

# Access at http://localhost:8000
```

### Help

```bash
fxdif --help
```

## Default Exclusions

By default, these folders are excluded from all comparisons:
- `.git`
- `node_modules`
- `vendor`
- `composer`
- `__pycache__`
- `.pytest_cache`
- `.next`
- `.nuxt`
- `dist`
- `build`
- `.deno`

## Keyboard Shortcuts (TUI)

- `Alt + ↓` - Navigate to next different file
- `Alt + ↑` - Navigate to previous different file
- `Enter` - View file diff
- `Tab` - Switch between columns
- `Ctrl + C` - Exit
- `?` - Show help

## Technology Stack

- **Runtime**: Deno 2
- **TUI**: Cliffy (tables, prompts, CLI)
- **Database**: SQLite
- **Web Backend**: Hono
- **Web Frontend**: React + ShadCN UI
- **Code Editor**: Monaco (VS Code editor)

## Development

```bash
# Run in development mode
deno task dev

# Compile
deno task compile
```

## License

MIT

## Author

Built with Claude Code
