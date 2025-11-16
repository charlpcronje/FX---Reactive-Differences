# Contributing to FXDif

Thank you for your interest in contributing to FXDif! This document provides guidelines and instructions for contributing.

## Table of Contents

1. [Code of Conduct](#code-of-conduct)
2. [Getting Started](#getting-started)
3. [Development Setup](#development-setup)
4. [Project Structure](#project-structure)
5. [How to Contribute](#how-to-contribute)
6. [Coding Standards](#coding-standards)
7. [Testing](#testing)
8. [Submitting Changes](#submitting-changes)

## Code of Conduct

- Be respectful and inclusive
- Welcome newcomers and help them get started
- Focus on constructive feedback
- Maintain a positive and collaborative environment

## Getting Started

### Prerequisites

- Deno 2.0 or higher
- Git
- A code editor (VS Code recommended)
- Basic knowledge of TypeScript

### Fork and Clone

1. Fork the repository on GitHub
2. Clone your fork:
   ```bash
   git clone https://github.com/YOUR_USERNAME/FX---Reactive-Differences.git
   cd FX---Reactive-Differences
   ```

## Development Setup

1. **Install Deno** (if not already installed)
   ```bash
   # Linux/Mac
   curl -fsSL https://deno.land/install.sh | sh

   # Windows
   irm https://deno.land/install.ps1 | iex
   ```

2. **Run in Development Mode**
   ```bash
   deno task dev
   ```

3. **Test Your Changes**
   ```bash
   # Test the CLI
   deno run --allow-all src/main.ts --help

   # Test project creation
   deno run --allow-all src/main.ts

   # Test web server
   deno run --allow-all src/main.ts --host
   ```

## Project Structure

```
FX---Reactive-Differences/
├── src/
│   ├── cli/              # Command-line interface
│   │   ├── parser.ts     # Argument parsing
│   │   └── handlers.ts   # Command handlers
│   ├── core/             # Core business logic
│   │   ├── scanner.ts    # File scanning
│   │   └── comparator.ts # Folder comparison
│   ├── db/               # Database layer
│   │   ├── schema.ts     # Database schema
│   │   ├── projects.ts   # Project repository
│   │   └── rules.ts      # Rules repository
│   ├── tui/              # Terminal UI
│   │   └── viewer.ts     # TUI components
│   ├── web/              # Web server
│   │   └── server.ts     # Hono API server
│   └── main.ts           # Entry point
├── scripts/              # Build scripts
├── docs/                 # Documentation
└── tests/                # Tests (to be added)
```

## How to Contribute

### Reporting Bugs

1. Check if the bug has already been reported
2. Create a new issue with:
   - Clear title
   - Detailed description
   - Steps to reproduce
   - Expected vs actual behavior
   - Deno version and OS
   - Screenshots if applicable

### Suggesting Features

1. Check existing issues for similar suggestions
2. Create a new issue with:
   - Clear description of the feature
   - Use cases and benefits
   - Possible implementation approach

### Contributing Code

Areas where contributions are especially welcome:

- **Web Frontend**: React UI with ShadCN components
- **Tests**: Unit and integration tests
- **Documentation**: Improve existing docs
- **Performance**: Optimize file scanning and comparison
- **Features**: Implement items from the roadmap
- **Bug Fixes**: Fix reported issues

## Coding Standards

### TypeScript Style

```typescript
// Use descriptive names
function scanFolder() { } // ✗ Bad
function scanFolderForTextFiles() { } // ✓ Good

// Use interfaces for object shapes
interface FileInfo {
  path: string;
  size: number;
}

// Use async/await over promises
async function readFile() { } // ✓ Good

// Add JSDoc comments for public APIs
/**
 * Scans a folder and returns all text files
 * @param folderPath - Path to scan
 * @param options - Scan options
 * @returns Array of file info objects
 */
async function scanFolder(
  folderPath: string,
  options: ScanOptions
): Promise<FileInfo[]> { }
```

### Code Organization

- One class/interface per file (unless tightly coupled)
- Group related functions together
- Keep files under 500 lines
- Extract complex logic into separate functions

### Error Handling

```typescript
// Always handle errors gracefully
try {
  const data = await Deno.readFile(path);
} catch (error) {
  console.error(`Failed to read file: ${path}`, error);
  return null;
}

// Use descriptive error messages
throw new Error(`Project "${code}" not found`);
```

### Database Operations

- Always use parameterized queries
- Close database connections in finally blocks
- Use transactions for multiple related operations

## Testing

### Running Tests

```bash
# Run all tests
deno test --allow-all

# Run specific test file
deno test --allow-all tests/scanner.test.ts

# Run with coverage
deno test --allow-all --coverage=coverage
```

### Writing Tests

```typescript
// tests/scanner.test.ts
import { assertEquals } from "@std/assert";
import { FileScanner } from "../src/core/scanner.ts";

Deno.test("FileScanner - scans text files only", async () => {
  const scanner = new FileScanner();
  const files = await scanner.scanFolder("./test-data", {
    excludeFolders: [".git"]
  });

  assertEquals(files.length > 0, true);
  // Add more assertions
});
```

## Submitting Changes

### Commit Messages

Follow the conventional commits format:

```
type(scope): subject

body

footer
```

Types:
- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation
- `style`: Formatting
- `refactor`: Code restructuring
- `test`: Adding tests
- `chore`: Maintenance

Examples:
```
feat(cli): add support for multiple file extensions

Allows users to specify multiple extensions like:
  fxdif project .js+ .ts+ .jsx+

Closes #123

---

fix(db): prevent duplicate folder entries

Added unique constraint check before insertion

---

docs(readme): update installation instructions

Added Windows-specific PATH setup guide
```

### Pull Request Process

1. **Create a Branch**
   ```bash
   git checkout -b feature/my-new-feature
   # or
   git checkout -b fix/issue-123
   ```

2. **Make Changes**
   - Write clean, tested code
   - Follow coding standards
   - Update documentation

3. **Test Thoroughly**
   ```bash
   # Test all functionality
   deno task dev

   # Run tests
   deno test --allow-all

   # Test compilation
   deno task compile
   ```

4. **Commit Changes**
   ```bash
   git add .
   git commit -m "feat(scanner): add binary file detection"
   ```

5. **Push to Your Fork**
   ```bash
   git push origin feature/my-new-feature
   ```

6. **Create Pull Request**
   - Go to GitHub
   - Click "New Pull Request"
   - Fill in the template
   - Link related issues

### Pull Request Checklist

- [ ] Code follows project style guidelines
- [ ] Self-review completed
- [ ] Comments added for complex logic
- [ ] Documentation updated
- [ ] Tests added/updated
- [ ] All tests pass
- [ ] No console warnings or errors
- [ ] Compilation successful

## Development Tips

### Useful Commands

```bash
# Format code
deno fmt

# Lint code
deno lint

# Check types
deno check src/main.ts

# Watch mode for development
deno task dev --watch
```

### Debugging

```typescript
// Add debug logging
const DEBUG = Deno.env.get("DEBUG") === "1";

if (DEBUG) {
  console.log("Debug info:", someVariable);
}
```

Run with debugging:
```bash
DEBUG=1 deno task dev
```

### Database Inspection

```bash
# View database location
echo $HOME/.fxdif/fxdif.db  # Linux/Mac
echo %USERPROFILE%\.fxdif\fxdif.db  # Windows

# Open with SQLite browser
sqlite3 ~/.fxdif/fxdif.db
```

## Resources

- [Deno Manual](https://deno.land/manual)
- [Deno Standard Library](https://deno.land/std)
- [TypeScript Handbook](https://www.typescriptlang.org/docs/)
- [Cliffy Documentation](https://cliffy.io/)
- [Hono Documentation](https://hono.dev/)

## Questions?

- Open an issue for general questions
- Tag maintainers in PR comments
- Check existing issues and discussions

## License

By contributing, you agree that your contributions will be licensed under the MIT License.

---

Thank you for contributing to FXDif! 🎯
