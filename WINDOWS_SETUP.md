# Windows Setup Guide for FXDif

This guide will help you set up FXDif on Windows 11 so you can run it from anywhere by simply typing `fxdif`.

## Prerequisites

1. **Install Deno** (if not already installed)
   - Visit https://deno.land
   - Download and run the Windows installer
   - Or use PowerShell:
     ```powershell
     irm https://deno.land/install.ps1 | iex
     ```

2. **Verify Deno Installation**
   ```powershell
   deno --version
   ```

## Installation Steps

### Method 1: Quick Install (Recommended)

1. **Clone or Download this repository**
   ```powershell
   git clone <repository-url>
   cd FX---Reactive-Differences
   ```

2. **Run the build script**
   ```powershell
   deno task compile:windows
   ```

3. **Create a permanent location for the executable**
   ```powershell
   # Create a tools directory in your user profile
   New-Item -Path "$env:USERPROFILE\Tools" -ItemType Directory -Force

   # Copy the executable
   Copy-Item "dist\fxdif.exe" -Destination "$env:USERPROFILE\Tools\fxdif.exe"
   ```

4. **Add to PATH**

   **Option A: Using PowerShell (Permanent)**
   ```powershell
   # Get current PATH
   $currentPath = [Environment]::GetEnvironmentVariable("Path", "User")

   # Add new path
   $newPath = "$env:USERPROFILE\Tools"

   # Update PATH if not already included
   if ($currentPath -notlike "*$newPath*") {
       [Environment]::SetEnvironmentVariable(
           "Path",
           "$currentPath;$newPath",
           "User"
       )
   }

   Write-Host "PATH updated! Please restart your terminal."
   ```

   **Option B: Using GUI**
   1. Press `Win + X` and select "System"
   2. Click "Advanced system settings"
   3. Click "Environment Variables"
   4. Under "User variables", select "Path" and click "Edit"
   5. Click "New" and add: `C:\Users\<YourUsername>\Tools`
   6. Click OK on all dialogs
   7. Restart your terminal

5. **Verify Installation**
   ```powershell
   # Open a NEW terminal window
   fxdif --help
   ```

### Method 2: Manual Setup

1. **Compile the application**
   ```powershell
   deno compile --allow-all --target x86_64-pc-windows-msvc --output dist/fxdif.exe src/main.ts
   ```

2. **Choose installation location** (pick one):
   - `C:\Tools\fxdif.exe`
   - `C:\Program Files\FXDif\fxdif.exe`
   - `%USERPROFILE%\Tools\fxdif.exe`

3. **Add to PATH** (see Option B above)

## Usage

Once installed, you can use `fxdif` from any directory:

### Create a New Project
```powershell
cd C:\dev\myproject
fxdif
```

### Add Folders to Compare
```powershell
cd C:\dev\myproject-copy
fxdif myproject+
```

### View Differences
```powershell
fxdif myproject
```

### Start Web Interface
```powershell
fxdif --host
```

Then open your browser to: http://localhost:8000

## Troubleshooting

### "fxdif is not recognized as an internal or external command"

**Solution:**
1. Verify the executable exists: `Test-Path "$env:USERPROFILE\Tools\fxdif.exe"`
2. Check your PATH: `$env:Path -split ';'`
3. Restart your terminal
4. If still not working, log out and log back in to Windows

### Permission Denied Errors

**Solution:**
Run PowerShell as Administrator:
```powershell
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
```

### Database Location

FXDif stores its database in:
```
%USERPROFILE%\.fxdif\fxdif.db
```

To view or backup your database:
```powershell
explorer $env:USERPROFILE\.fxdif
```

### Uninstall

```powershell
# Remove executable
Remove-Item "$env:USERPROFILE\Tools\fxdif.exe"

# Remove database (optional - this deletes all your projects!)
Remove-Item -Recurse "$env:USERPROFILE\.fxdif"

# Remove from PATH (manual - use GUI method described above)
```

## Advanced Configuration

### Custom Database Location

Set the `FXDIF_DB_PATH` environment variable:

```powershell
[Environment]::SetEnvironmentVariable(
    "FXDIF_DB_PATH",
    "D:\MyDatabases\fxdif.db",
    "User"
)
```

### Custom Port for Web Server

```powershell
fxdif --host --port 3000
```

## Example Workflows

### Compare Multiple Environments

```powershell
# Set up project
cd C:\dev\myapp-production
fxdif
# Enter project name: "myapp"

# Add staging environment
cd C:\dev\myapp-staging
fxdif myapp+

# Add development environment
cd C:\dev\myapp-development
fxdif myapp+

# View all differences
fxdif myapp
```

### Filter by File Types

```powershell
# Only compare PHP files
fxdif myapp .php+

# Exclude test files
fxdif myapp .test.js- .spec.ts-

# Combine multiple rules
fxdif myapp .php+ .js+ .css+ .html+
```

## Support

For issues or questions:
- GitHub Issues: https://github.com/anthropics/fxdif/issues
- Documentation: README.md
- Help: `fxdif --help`
