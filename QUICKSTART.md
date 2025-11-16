# Quick Start Guide

Get FXDif up and running in 5 minutes!

## Installation

### Windows

```powershell
# 1. Install Deno (if needed)
irm https://deno.land/install.ps1 | iex

# 2. Clone and build
git clone <repository-url>
cd FX---Reactive-Differences

# 3. Run installation script
.\scripts\install-windows.ps1

# 4. Restart your terminal
```

### Linux/Mac

```bash
# 1. Install Deno (if needed)
curl -fsSL https://deno.land/install.sh | sh

# 2. Clone and build
git clone <repository-url>
cd FX---Reactive-Differences

# 3. Build
chmod +x scripts/build.sh
./scripts/build.sh

# 4. Install globally (optional)
sudo mv dist/fxdif /usr/local/bin/
```

## First Use

### 1. Create Your First Project

```bash
# Navigate to your project folder
cd /path/to/your/project

# Create a new FXDif project
fxdif

# Answer the prompts:
# Project name: My Project
# Project code: myproject
```

### 2. Add Folders to Compare

```bash
# Navigate to another copy of your project
cd /path/to/project-copy

# Add it to your FXDif project
fxdif myproject+
```

### 3. View Differences

```bash
# From anywhere, run:
fxdif myproject
```

You'll see a beautiful table showing all differences!

## Common Use Cases

### Compare Production vs Staging

```bash
# Master (production)
cd /var/www/production
fxdif prod

# Add staging
cd /var/www/staging
fxdif prod+

# View
fxdif prod
```

### Filter by File Type

```bash
# Only compare JavaScript files
fxdif myproject .js+ .ts+

# Exclude test files
fxdif myproject .test.js-
```

### Web Interface

```bash
# Start the web server
fxdif --host

# Open browser to: http://localhost:8000
```

## Next Steps

- Read the [full documentation](README.md)
- Check out [examples](EXAMPLES.md)
- Explore the [API](#api-reference)

## Troubleshooting

**Can't run `fxdif` command?**
- Make sure you restarted your terminal after installation
- Check that the installation directory is in your PATH

**Permission errors?**
- On Linux/Mac: Make sure the binary is executable (`chmod +x`)
- On Windows: Run PowerShell as Administrator

**Database issues?**
- Database is stored in `~/.fxdif/` (or `%USERPROFILE%\.fxdif\` on Windows)
- You can delete this folder to start fresh

## Help

```bash
fxdif --help
```

For more help, see the [full README](README.md) or open an issue on GitHub.

Happy comparing! 🎯
