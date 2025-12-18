#!/bin/bash

# Build Script for macOS and Linux
# Usage: ./build_all.sh [platform]
# platform: mac, linux, or all (default)

PLATFORM=${1:-all}

echo "Building VARS..."
echo "Target: $PLATFORM"

# Ensure electron-builder is installed
if ! npm list electron-builder > /dev/null 2>&1; then
    echo "Installing dependencies..."
    npm install
    if [ $? -ne 0 ]; then
        echo "Error: npm install failed."
        exit 1
    fi
fi

if [ "$PLATFORM" == "mac" ] || [ "$PLATFORM" == "all" ]; then
    echo "-----------------------------------"
    echo "Starting macOS Build (ARM64 + x64)..."
    echo "-----------------------------------"
    # Build separate binaries for ARM64 (Apple Silicon) and x64 (Intel)
    # Note: Using separate builds instead of universal to avoid TCC permission issues
    echo "Building for Apple Silicon (arm64)..."
    npx electron-builder --mac --arm64
    echo "Building for Intel (x64)..."
    npx electron-builder --mac --x64
fi

if [ "$PLATFORM" == "linux" ] || [ "$PLATFORM" == "all" ]; then
    echo "-----------------------------------"
    echo "Starting Linux Build..."
    echo "-----------------------------------"
    npx electron-builder --linux
fi

echo "-----------------------------------"
echo "Build complete! Check the 'dist' folder."
echo "-----------------------------------"
