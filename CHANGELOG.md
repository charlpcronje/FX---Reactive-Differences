# Changelog

All notable changes to FXDif will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2024-11-16

### Added

#### Core Features
- 🎯 Multi-folder comparison engine
- 📊 Project management system with SQLite database
- 🔍 Smart file scanning with configurable filters
- ⚡ SHA-256 based file comparison
- 🗃️ Soft delete support for all entities

#### CLI Interface
- ✨ Interactive project creation wizard
- ➕ Folder add/remove operations (`project+`, `project-`)
- 🎨 Beautiful TUI with table-based visualization
- 📝 Extension filtering (`.php+`, `.js-`)
- 📄 File-specific rules (`config.php-`)
- ❓ Comprehensive help system (`--help`)

#### Web Interface
- 🌐 Hono-based REST API
- 🔌 CORS-enabled API endpoints
- 📡 Project listing and management
- 🔄 Real-time comparison results
- 📊 JSON-formatted responses

#### Database
- 💾 SQLite-based storage
- 🏗️ Auto-migrating schema
- 🔗 Relational project/folder structure
- 📋 Flexible rule system (extensions, files, folders)
- 🚫 Default exclusion templates (node_modules, .git, etc.)

#### Developer Experience
- 📦 Single-file compilation with Deno
- 🔧 Cross-platform support (Windows, Linux, Mac)
- 📚 Comprehensive documentation
- 🎓 Example workflows and use cases
- 🔨 Build scripts for all platforms

### API Endpoints

- `GET /api/projects` - List all projects
- `GET /api/projects/:code` - Get project details
- `GET /api/projects/:code/folders` - Get project folders
- `GET /api/projects/:code/compare` - Get comparison results
- `GET /api/files/content?path=...` - Get file content

### Documentation

- README.md - Main documentation
- WINDOWS_SETUP.md - Windows installation guide
- EXAMPLES.md - Real-world usage examples
- CONTRIBUTING.md - Contribution guidelines
- QUICKSTART.md - 5-minute setup guide
- CHANGELOG.md - This file

### Default Exclusions

The following folders are excluded by default:
- `.git`
- `node_modules`
- `vendor`
- `__pycache__`
- `.pytest_cache`
- `.next`
- `.nuxt`
- `dist`
- `build`
- `.deno`
- `target`
- `.vscode`
- `.idea`

### Supported File Types

Text-based files with common extensions:
- Programming: `.js`, `.ts`, `.py`, `.php`, `.go`, `.rs`, `.java`, `.c`, `.cpp`
- Web: `.html`, `.css`, `.scss`, `.jsx`, `.tsx`, `.vue`, `.svelte`
- Config: `.json`, `.yaml`, `.toml`, `.ini`, `.env`
- Documentation: `.md`, `.txt`

## [Unreleased]

### Planned Features

#### High Priority
- [ ] React-based web UI with ShadCN components
- [ ] Monaco editor integration for file diffs
- [ ] Interactive keyboard navigation in TUI
- [ ] Real-time file watching
- [ ] Diff view for modified files

#### Medium Priority
- [ ] Export comparison results (HTML, PDF, CSV)
- [ ] Git integration
- [ ] Ignore file support (.fxdifignore)
- [ ] Custom exclusion templates
- [ ] Folder comparison metrics (stats, graphs)

#### Low Priority
- [ ] Plugin system
- [ ] Custom themes for TUI
- [ ] Multi-language support
- [ ] Cloud sync for projects
- [ ] Team collaboration features

### Known Issues

- TUI keyboard navigation not yet implemented (planned for 1.1.0)
- Web UI is currently a placeholder (planned for 1.2.0)
- Large binary files may slow down comparison
- No progress indicator for large folder scans

## Versioning Strategy

- **Major (X.0.0)**: Breaking changes, major rewrites
- **Minor (1.X.0)**: New features, non-breaking changes
- **Patch (1.0.X)**: Bug fixes, small improvements

## Migration Guide

### From 0.x to 1.0

This is the initial release, no migration needed.

## Release Notes

### v1.0.0 - "Foundation"

This initial release establishes the core functionality of FXDif:

**What's Working:**
✅ Project creation and management
✅ Multi-folder comparison
✅ File filtering (extensions, specific files)
✅ TUI visualization
✅ REST API
✅ Cross-platform compilation

**What's Coming:**
🔜 Interactive TUI navigation
🔜 Full web interface
🔜 Visual diff viewer
🔜 Export capabilities

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines on contributing to this changelog and the project.

## Links

- [Repository](https://github.com/anthropics/FX---Reactive-Differences)
- [Issue Tracker](https://github.com/anthropics/FX---Reactive-Differences/issues)
- [Documentation](README.md)

---

**Legend:**
- 🎯 Feature
- 🐛 Bug Fix
- 🔧 Technical
- 📚 Documentation
- ⚡ Performance
- 🔒 Security
- ⚠️ Deprecated
- 🗑️ Removed
