#!/bin/bash

# Post-install script to copy prisma schema from apps/common and manage AUTH_SECRET
# This ensures we have the latest prisma schema and a valid AUTH_SECRET after npm install


echo ""
echo "🔐 Managing AUTH_SECRET in .env..."

# Define the .env.local file path
ENV_FILE=".env"

# Generate a new AUTH_SECRET
NEW_AUTH_SECRET=$(openssl rand -base64 32)

# Create .env.local if it doesn't exist
if [ ! -f "$ENV_FILE" ]; then
    echo "📄 Creating new $ENV_FILE file"
    touch "$ENV_FILE"
fi

# Remove any existing AUTH_SECRET lines (ignore errors if none exist)
if grep -q "AUTH_SECRET" "$ENV_FILE" 2>/dev/null; then
    echo "🔄 Replacing existing AUTH_SECRET"
    # Use sed to remove any lines containing AUTH_SECRET=
    sed -i.bak '/AUTH_SECRET/d' "$ENV_FILE"
    # Remove the backup file created by sed
    rm -f "$ENV_FILE.bak"
else
    echo "➕ Adding new AUTH_SECRET"
fi

# Ensure the file ends with a newline before appending
if [ -s "$ENV_FILE" ] && [ "$(tail -c1 "$ENV_FILE")" != "" ]; then
    echo "" >> "$ENV_FILE"
fi

# Append the new AUTH_SECRET to the file
echo "AUTH_SECRET=\"$NEW_AUTH_SECRET\"" >> "$ENV_FILE"

echo "✅ AUTH_SECRET successfully updated in $ENV_FILE"
