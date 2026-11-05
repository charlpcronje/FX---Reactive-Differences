#!/bin/bash
# FXDif Build Script for Linux/Mac

set -e

echo "🎯 FXDif Build Script"
echo "====================="
echo ""

# Check if Deno is installed
echo "Checking for Deno..."
if ! command -v deno &> /dev/null; then
    echo "✗ Deno is not installed"
    echo ""
    echo "Please install Deno first:"
    echo "  curl -fsSL https://deno.land/install.sh | sh"
    echo ""
    exit 1
fi

echo "✓ Deno is installed"
deno --version | head -n 1
echo ""

# Create dist directory
mkdir -p dist

# Compile for current platform
echo "Compiling FXDif..."
deno compile --allow-all --output dist/fxdif src/main.ts

echo "✓ Compilation successful"
echo ""
echo "Executable created at: dist/fxdif"
echo ""
echo "To install globally:"
echo "  sudo mv dist/fxdif /usr/local/bin/"
echo ""
echo "Or add to PATH:"
echo "  export PATH=\"\$PATH:$(pwd)/dist\""
echo ""
