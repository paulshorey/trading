#!/bin/bash

# Post-install script to copy prisma schema from apps/common
# This ensures we have the latest prisma schema after npm install

set -e  # Exit on any error

echo "🔧 Post-install: Copying Prisma schema from apps/common..."

# Define source and destination paths
SOURCE_DIR="../data/prisma"
DEST_DIR="./prisma"

# Check if source directory exists
if [ ! -d "$SOURCE_DIR" ]; then
    echo "❌ Error: Source directory $SOURCE_DIR does not exist"
    exit 1
fi

# Create destination directory if it doesn't exist
mkdir -p "$DEST_DIR"

# Copy the prisma files
echo "📁 Copying from $SOURCE_DIR to $DEST_DIR"
cp -r "$SOURCE_DIR"/. "$DEST_DIR"/

echo "✅ Successfully copied Prisma schema files"
echo "📋 Files copied:"
ls -la "$DEST_DIR"
