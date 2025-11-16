# FXDif - Project Overview

## Executive Summary

FXDif is a powerful, cross-platform folder comparison tool built with Deno 2. It allows users to track and visualize differences across multiple copies of the same project, making it ideal for managing multi-environment deployments, tracking customizations, and ensuring consistency across codebases.

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                     FXDif System                        │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  ┌─────────────┐      ┌──────────────┐                │
│  │   CLI Tool  │      │  Web Server  │                │
│  │   (Main)    │      │    (Hono)    │                │
│  └──────┬──────┘      └──────┬───────┘                │
│         │                    │                         │
│         └────────┬───────────┘                         │
│                  │                                     │
│         ┌────────▼────────┐                           │
│         │  Core Engine    │                           │
│         ├─────────────────┤                           │
│         │ • Scanner       │                           │
│         │ • Comparator    │                           │
│         │ • File Hasher   │                           │
│         └────────┬────────┘                           │
│                  │                                     │
│         ┌────────▼────────┐                           │
│         │  Database Layer │                           │
│         ├─────────────────┤                           │
│         │ • Projects      │                           │
│         │ • Folders       │                           │
│         │ • Rules         │                           │
│         └─────────────────┘                           │
│                  │                                     │
│         ┌────────▼────────┐                           │
│         │     SQLite      │                           │
│         │   (~/.fxdif/)   │                           │
│         └─────────────────┘                           │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

## Component Details

### 1. CLI Interface (`src/cli/`)

**parser.ts**
- Parses command-line arguments
- Detects operation type (new, add, remove, view, host, help)
- Extracts file extension and file rules
- Handles `+` and `-` modifiers

**handlers.ts**
- Implements command handlers
- Interactive project creation wizard
- Folder add/remove operations
- Rule management (extensions, files)
- User prompts and confirmations

### 2. Core Engine (`src/core/`)

**scanner.ts**
- Walks directory trees
- Filters files by type, extension, and rules
- Respects exclusion patterns
- Returns file metadata (path, size, modified date)
- Computes SHA-256 hashes for file comparison

**comparator.ts**
- Orchestrates multi-folder comparison
- Identifies identical, modified, missing, and extra files
- Generates comparison statistics
- Returns structured comparison results

### 3. Database Layer (`src/db/`)

**schema.ts**
- Defines database structure
- Path normalization (Windows ↔ Unix)
- Database initialization
- Default exclusion templates
- Connection management

**projects.ts**
- Project CRUD operations
- Folder management
- Master folder designation
- Soft delete support

**rules.ts**
- File/extension rule management
- Global vs folder-specific rules
- Rule priority and application
- Default exclusion retrieval

### 4. TUI Viewer (`src/tui/`)

**viewer.ts**
- Table-based file listing
- Color-coded status indicators
- Summary statistics display
- Keyboard shortcuts documentation
- Help screen

### 5. Web Server (`src/web/`)

**server.ts**
- Hono-based REST API
- CORS-enabled endpoints
- JSON response formatting
- File content retrieval
- Beautiful landing page

## Data Models

### Project
```typescript
{
  id: number
  project_name: string
  project_code: string
  base_path: string
  created_at: datetime
  updated_at: datetime
  is_deleted: 0 | 1
}
```

### ProjectFolder
```typescript
{
  id: number
  project_id: number
  folder_path: string
  is_master: 0 | 1
  created_at: datetime
  is_deleted: 0 | 1
}
```

### FileRule
```typescript
{
  id: number
  project_id: number
  folder_path?: string
  rule_type: 'extension' | 'file' | 'folder'
  pattern: string
  action: 'include' | 'exclude'
  created_at: datetime
  is_deleted: 0 | 1
}
```

## Command Flow

### Creating a New Project
```
User runs: fxdif
    ↓
Parser detects no args → action='new'
    ↓
Handler prompts for project name and code
    ↓
ProjectRepository creates project record
    ↓
ProjectRepository adds current folder as master
    ↓
Display success message with next steps
```

### Adding a Folder
```
User runs: fxdif myproject+
    ↓
Parser extracts project_code='myproject', action='add'
    ↓
Handler retrieves project from database
    ↓
Handler normalizes current path
    ↓
ProjectRepository adds folder to project
    ↓
Display confirmation
```

### Viewing Differences
```
User runs: fxdif myproject
    ↓
Parser extracts project_code='myproject', action='view'
    ↓
Handler retrieves project and folders
    ↓
Scanner scans all folders with rules
    ↓
Comparator computes differences
    ↓
TUI Viewer renders comparison table
```

## File Comparison Algorithm

1. **Scan Phase**
   - Walk each folder recursively
   - Apply exclusion rules (default + custom)
   - Collect file metadata
   - Sort by relative path

2. **Map Phase**
   - Create map of all unique relative paths
   - Mark which folders contain each file

3. **Hash Phase**
   - Compute SHA-256 for each file
   - Cache hashes for performance

4. **Compare Phase**
   - Compare hashes across folders
   - Classify as: identical, modified, missing, extra
   - Generate statistics

5. **Present Phase**
   - Sort results by path
   - Apply filters (show only differences)
   - Render in TUI or return via API

## Path Normalization

Windows paths are normalized for cross-platform database storage:

```
Windows:     C:\dev\myproject
Stored as:   C--dev/myproject
Retrieved:   C:\dev\myproject (on Windows)
             C--dev/myproject (on Unix)
```

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/projects` | List all projects |
| GET | `/api/projects/:code` | Get project details |
| GET | `/api/projects/:code/folders` | Get project folders |
| GET | `/api/projects/:code/compare` | Get comparison results |
| GET | `/api/files/content?path=...` | Get file content |

## File Type Detection

The scanner automatically detects text files by extension:

**Programming Languages:**
`.js`, `.ts`, `.jsx`, `.tsx`, `.py`, `.php`, `.rb`, `.java`, `.c`, `.cpp`, `.h`, `.cs`, `.go`, `.rs`, `.swift`, `.kt`, `.scala`

**Web Technologies:**
`.html`, `.css`, `.scss`, `.sass`, `.less`, `.vue`, `.svelte`, `.astro`

**Configuration:**
`.json`, `.yaml`, `.yml`, `.toml`, `.ini`, `.conf`, `.env`

**Scripts:**
`.sh`, `.bash`, `.zsh`, `.fish`

**Documentation:**
`.md`, `.txt`

## Default Exclusions

These folders are automatically excluded from scans:

```
.git            - Git repository
node_modules    - Node.js dependencies
vendor          - PHP/Go dependencies
__pycache__     - Python cache
.pytest_cache   - Pytest cache
.next           - Next.js build
.nuxt           - Nuxt.js build
dist            - Distribution folder
build           - Build folder
.deno           - Deno cache
target          - Rust build
.vscode         - VS Code settings
.idea           - IntelliJ settings
```

## Performance Considerations

**Optimization Strategies:**
1. Skip excluded folders early (no traversal)
2. Hash files only once per comparison
3. Use indexed database queries
4. Lazy load file contents (API only)
5. Cache comparison results (future)

**Scalability:**
- Handles projects with 10,000+ files
- Fast SHA-256 hashing with Web Crypto API
- Efficient SQLite queries with indexes
- Streaming file I/O for large files

## Security

**Considerations:**
- No authentication (local tool)
- Database stored in user home directory
- No network access except web server
- File paths sanitized before storage
- Parameterized SQL queries (no injection)

**Permissions Required:**
- Read: All compared folders
- Write: Database directory (`~/.fxdif/`)
- Network: Only when running `--host`

## Future Enhancements

**Phase 2 (v1.1):**
- [ ] Interactive TUI navigation with arrow keys
- [ ] Real-time file watching
- [ ] Progress indicators for large scans
- [ ] Diff view for modified files
- [ ] Export to HTML/PDF

**Phase 3 (v1.2):**
- [ ] React web UI with ShadCN components
- [ ] Monaco editor for code viewing
- [ ] Visual diff with syntax highlighting
- [ ] User authentication (optional)
- [ ] Team collaboration features

**Phase 4 (v2.0):**
- [ ] Git integration
- [ ] Plugin system
- [ ] Custom themes
- [ ] Cloud sync (optional)
- [ ] Multi-language support

## Development Workflow

1. **Local Development**
   ```bash
   deno task dev --arg1 --arg2
   ```

2. **Type Checking**
   ```bash
   deno check src/main.ts
   ```

3. **Formatting**
   ```bash
   deno fmt
   ```

4. **Linting**
   ```bash
   deno lint
   ```

5. **Compilation**
   ```bash
   deno task compile:windows
   # or
   ./scripts/build.sh
   ```

## Testing Strategy

**Unit Tests** (to be added)
- Scanner file filtering
- Path normalization
- Rule application
- Hash computation

**Integration Tests**
- Project CRUD operations
- Multi-folder comparison
- API endpoints
- CLI command parsing

**E2E Tests**
- Complete workflows
- Cross-platform compatibility
- Performance benchmarks

## Deployment

**Windows:**
```powershell
.\scripts\install-windows.ps1
```

**Linux/Mac:**
```bash
./scripts/build.sh
sudo mv dist/fxdif /usr/local/bin/
```

**Docker** (future):
```bash
docker run -v ~/.fxdif:/root/.fxdif fxdif
```

## Troubleshooting

**Common Issues:**

1. **Command not found**
   - Solution: Add to PATH, restart terminal

2. **Permission denied**
   - Solution: `chmod +x` on Linux/Mac

3. **Database locked**
   - Solution: Close other instances

4. **Slow comparison**
   - Solution: Add more exclusions, filter file types

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for:
- Code style guidelines
- Testing requirements
- Pull request process
- Development setup

## Resources

- **Documentation**: [README.md](README.md)
- **Quick Start**: [QUICKSTART.md](QUICKSTART.md)
- **Examples**: [EXAMPLES.md](EXAMPLES.md)
- **Windows Setup**: [WINDOWS_SETUP.md](WINDOWS_SETUP.md)
- **Changelog**: [CHANGELOG.md](CHANGELOG.md)

## License

MIT License - see [LICENSE](LICENSE) file

## Support

- **Issues**: GitHub Issues
- **Discussions**: GitHub Discussions
- **Email**: support@fxdif.dev (if available)

---

**Built with:**
- Deno 2.0
- TypeScript
- SQLite
- Cliffy (CLI framework)
- Hono (Web framework)
- ❤️ and ☕

**Version:** 1.0.0
**Last Updated:** 2024-11-16
