# FXDif Windows Installation Script
# Run this script in PowerShell to install FXDif

param(
    [string]$InstallPath = "$env:USERPROFILE\Tools",
    [switch]$SkipPathUpdate
)

$ErrorActionPreference = "Stop"

Write-Host "🎯 FXDif Installation Script" -ForegroundColor Cyan
Write-Host "================================`n" -ForegroundColor Cyan

# Check if Deno is installed
Write-Host "Checking for Deno..." -ForegroundColor Yellow
try {
    $denoVersion = deno --version
    Write-Host "✓ Deno is installed" -ForegroundColor Green
    Write-Host "  $($denoVersion.Split("`n")[0])" -ForegroundColor Gray
} catch {
    Write-Host "✗ Deno is not installed" -ForegroundColor Red
    Write-Host "`nPlease install Deno first:" -ForegroundColor Yellow
    Write-Host "  irm https://deno.land/install.ps1 | iex`n" -ForegroundColor White
    exit 1
}

# Compile the application
Write-Host "`nCompiling FXDif..." -ForegroundColor Yellow
try {
    deno compile --allow-all --target x86_64-pc-windows-msvc --output dist/fxdif.exe src/main.ts
    Write-Host "✓ Compilation successful" -ForegroundColor Green
} catch {
    Write-Host "✗ Compilation failed" -ForegroundColor Red
    Write-Host $_.Exception.Message -ForegroundColor Red
    exit 1
}

# Create installation directory
Write-Host "`nCreating installation directory..." -ForegroundColor Yellow
try {
    New-Item -Path $InstallPath -ItemType Directory -Force | Out-Null
    Write-Host "✓ Directory created: $InstallPath" -ForegroundColor Green
} catch {
    Write-Host "✗ Failed to create directory" -ForegroundColor Red
    Write-Host $_.Exception.Message -ForegroundColor Red
    exit 1
}

# Copy executable
Write-Host "`nInstalling executable..." -ForegroundColor Yellow
try {
    Copy-Item "dist\fxdif.exe" -Destination "$InstallPath\fxdif.exe" -Force
    Write-Host "✓ Executable installed: $InstallPath\fxdif.exe" -ForegroundColor Green
} catch {
    Write-Host "✗ Failed to copy executable" -ForegroundColor Red
    Write-Host $_.Exception.Message -ForegroundColor Red
    exit 1
}

# Update PATH
if (-not $SkipPathUpdate) {
    Write-Host "`nUpdating PATH..." -ForegroundColor Yellow
    try {
        $currentPath = [Environment]::GetEnvironmentVariable("Path", "User")

        if ($currentPath -notlike "*$InstallPath*") {
            $newPath = "$currentPath;$InstallPath"
            [Environment]::SetEnvironmentVariable("Path", $newPath, "User")
            Write-Host "✓ PATH updated" -ForegroundColor Green
            Write-Host "  Added: $InstallPath" -ForegroundColor Gray
        } else {
            Write-Host "✓ PATH already contains installation directory" -ForegroundColor Green
        }
    } catch {
        Write-Host "✗ Failed to update PATH" -ForegroundColor Red
        Write-Host $_.Exception.Message -ForegroundColor Red
        Write-Host "`nYou can manually add to PATH:" -ForegroundColor Yellow
        Write-Host "  $InstallPath`n" -ForegroundColor White
    }
}

# Success message
Write-Host "`n✨ Installation complete!" -ForegroundColor Green
Write-Host "`n📝 Next steps:" -ForegroundColor Cyan
Write-Host "  1. Restart your terminal" -ForegroundColor White
Write-Host "  2. Run: fxdif --help" -ForegroundColor White
Write-Host "  3. Navigate to a project folder and run: fxdif`n" -ForegroundColor White

Write-Host "💡 Quick start:" -ForegroundColor Cyan
Write-Host "  cd C:\your\project" -ForegroundColor White
Write-Host "  fxdif`n" -ForegroundColor White

Write-Host "🌐 Web interface:" -ForegroundColor Cyan
Write-Host "  fxdif --host`n" -ForegroundColor White
