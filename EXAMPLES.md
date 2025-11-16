# FXDif Usage Examples

This guide provides real-world examples of using FXDif to compare folders and track differences.

## Table of Contents

1. [Basic Workflow](#basic-workflow)
2. [Multi-Environment Comparison](#multi-environment-comparison)
3. [Framework Migration](#framework-migration)
4. [Code Synchronization](#code-synchronization)
5. [Advanced Filtering](#advanced-filtering)

---

## Basic Workflow

### Scenario: Track changes between production and staging

```bash
# Step 1: Initialize project in production folder
cd C:\websites\mysite-production
fxdif

# Interactive prompts:
# Project name: My Website
# Project code: mysite

# Step 2: Add staging folder
cd C:\websites\mysite-staging
fxdif mysite+

# Step 3: View differences
fxdif mysite
```

**Output:**
```
╔═══════════════════════════════════════════════╗
║        FXDif - Folder Comparison View        ║
╚═══════════════════════════════════════════════╝

Master Folder: C:\websites\mysite-production
Compare 1:     C:\websites\mysite-staging

📊 Summary:
   Total files:     247
   Identical:       245
   Modified:        2
   Missing:         0
   Extra:           0
```

---

## Multi-Environment Comparison

### Scenario: Compare production, staging, and development

```bash
# Set up master (production)
cd C:\dev\api-production
fxdif
# Name: API Server
# Code: api

# Add staging
cd C:\dev\api-staging
fxdif api+

# Add development
cd C:\dev\api-development
fxdif api+

# Add local copy
cd C:\dev\api-local
fxdif api+

# View all at once
cd C:\dev\api-production
fxdif api
```

**Result:** You'll see a table showing which files differ across all four environments.

---

## Framework Migration

### Scenario: Migrating from Vue 2 to Vue 3

```bash
# Master: Original Vue 2 project
cd C:\projects\myapp-vue2
fxdif
# Name: App Migration
# Code: appmig

# Add Vue 3 version
cd C:\projects\myapp-vue3
fxdif appmig+

# Only compare Vue files
fxdif appmig .vue+ .js+ .ts+

# Exclude build and config files
fxdif appmig webpack.config.js- package.json- package-lock.json-
```

---

## Code Synchronization

### Scenario: Sync code between Windows and WSL

```bash
# Windows side
cd C:\dev\myproject
fxdif
# Name: Cross-Platform Project
# Code: cross

# WSL side (same project)
cd /mnt/c/dev/myproject-wsl
fxdif cross+

# Compare
fxdif cross

# Exclude platform-specific files
fxdif cross .exe- .dll- .so- .dylib-
```

---

## Advanced Filtering

### Example 1: PHP Project - Only Compare Source Code

```bash
cd C:\xampp\htdocs\myapp
fxdif phpapp .php+ .html+ .css+ .js+

# Exclude vendor and cache
cd vendor
fxdif phpapp-

cd ../cache
fxdif phpapp-
```

### Example 2: Node.js Project - Exclude Tests

```bash
cd C:\dev\nodejs-app
fxdif nodeapp

# Exclude all test files
fxdif nodeapp .test.js- .spec.js- .test.ts- .spec.ts-

# Exclude specific test directory (run from that directory)
cd tests
fxdif nodeapp-
```

### Example 3: Monorepo - Compare Specific Package

```bash
cd C:\dev\monorepo\packages\ui
fxdif monorepo

# Only include TypeScript and React files
fxdif monorepo .ts+ .tsx+ .jsx+

# Exclude compiled output
cd dist
fxdif monorepo-
```

### Example 4: Documentation Project - Only Markdown

```bash
cd C:\docs\project-docs
fxdif docs .md+ .mdx+

# Include specific config file even if in excluded folder
fxdif docs _config.yml+
```

---

## Real-World Scenarios

### Scenario 1: Client Modifications Tracking

**Problem:** Client has modified their copy of your code. Need to see what changed.

```bash
# Your original code
cd C:\client-projects\original
fxdif clientx

# Client's modified version
cd C:\client-projects\clientx-modified
fxdif clientx+

# Compare only PHP and JS (ignore images, etc.)
fxdif clientx .php+ .js+ .css+

# View differences
fxdif clientx
```

### Scenario 2: Database Schema Comparison

**Problem:** Compare SQL files across environments.

```bash
cd C:\database\production\schemas
fxdif dbschema .sql+ .ddl+

cd C:\database\staging\schemas
fxdif dbschema+

cd C:\database\development\schemas
fxdif dbschema+

fxdif dbschema
```

### Scenario 3: Theme Customization

**Problem:** Track theme customizations across multiple WordPress sites.

```bash
# Original theme
cd C:\wordpress\site1\wp-content\themes\mytheme
fxdif theme

# Customized for site 2
cd C:\wordpress\site2\wp-content\themes\mytheme
fxdif theme+

# Customized for site 3
cd C:\wordpress\site3\wp-content\themes\mytheme
fxdif theme+

# Only compare theme files
fxdif theme .php+ .css+ .js+ .twig+

# View differences
fxdif theme
```

---

## Tips and Tricks

### 1. Quick Status Check

```bash
# From any folder in your project
fxdif myproject
```

### 2. Temporary Exclusions

```bash
# Exclude temp files just for this comparison
fxdif myproject .tmp- .bak- .swp-
```

### 3. Compare Specific Subdirectories

```bash
# Only compare the 'src' folder across environments
cd C:\project-prod\src
fxdif proj

cd C:\project-stage\src
fxdif proj+
```

### 4. Web Interface for Team Review

```bash
# Start web server
fxdif --host --port 8080

# Share with team: http://localhost:8080
# They can browse the API or view the web UI
```

### 5. Export Project List

```bash
# Use the API to get all projects (requires web server)
curl http://localhost:8000/api/projects > projects.json
```

---

## Troubleshooting Examples

### Problem: Too Many Files

**Solution:** Add more specific filters

```bash
# Instead of comparing everything
fxdif bigproject

# Filter to specific file types
fxdif bigproject .js+ .ts+ .jsx+ .tsx+

# Exclude large folders
cd node_modules
fxdif bigproject-

cd dist
fxdif bigproject-
```

### Problem: Binary Files Slow Comparison

**Solution:** Exclude binary files

```bash
fxdif project .jpg- .png- .gif- .pdf- .zip- .exe- .dll-
```

### Problem: Need to Revert Exclusion

**Solution:** Delete and re-add the folder

```bash
# Remove folder from project
cd C:\path\to\folder
fxdif project-

# Add it back
fxdif project+
```

---

## Integration Examples

### Git Pre-Commit Hook

```bash
#!/bin/bash
# .git/hooks/pre-commit

# Compare with production before committing
fxdif myproject > /tmp/fxdif-check.txt

if grep -q "Modified:" /tmp/fxdif-check.txt; then
    echo "⚠️  Differences detected with production"
    echo "Review: /tmp/fxdif-check.txt"
fi
```

### PowerShell Script for Batch Comparison

```powershell
# compare-all.ps1

$projects = @("web", "api", "mobile", "admin")

foreach ($proj in $projects) {
    Write-Host "`n=== Checking $proj ===" -ForegroundColor Cyan
    fxdif $proj
}
```

### Automated Report Generation

```bash
# generate-report.sh

#!/bin/bash

echo "# Deployment Diff Report" > report.md
echo "Generated: $(date)" >> report.md
echo "" >> report.md

fxdif production >> report.md
```

---

## Next Steps

- Read the [README.md](README.md) for installation instructions
- Check [WINDOWS_SETUP.md](WINDOWS_SETUP.md) for Windows-specific setup
- Run `fxdif --help` for command reference
- Start the web server with `fxdif --host` to explore the API

Happy comparing! 🎯
