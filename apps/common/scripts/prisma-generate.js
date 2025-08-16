#!/usr/bin/env node

/**
 * Script to generate Prisma client with environment-specific DATABASE_URL
 * Usage:
 *   node scripts/prisma-generate.js dev
 *   node scripts/prisma-generate.js prod
 */

const { execSync } = require("child_process");
const path = require("path");
const fs = require("fs");

// Get environment argument
const env = process.argv[2];

if (!env || !["dev", "prod"].includes(env)) {
  console.error("Usage: node scripts/prisma-generate.js <dev|prod>");
  console.error("Examples:");
  console.error("  node scripts/prisma-generate.js dev");
  console.error("  node scripts/prisma-generate.js prod");
  process.exit(1);
}

// Map environment to .env file
const envFiles = {
  dev: ".env.local",
  prod: ".env.production.local",
};

const envFile = envFiles[env];
const envPath = path.join(__dirname, "..", envFile);

// Check if .env file exists
if (!fs.existsSync(envPath)) {
  console.error(`Environment file not found: ${envFile}`);
  console.error("Please create this file with your DATABASE_URL configuration.");
  process.exit(1);
}

// Read and parse .env file
const envContent = fs.readFileSync(envPath, "utf8");
const envVars = {};

envContent.split("\n").forEach((line) => {
  const trimmed = line.trim();
  if (trimmed && !trimmed.startsWith("#")) {
    const [key, ...valueParts] = trimmed.split("=");
    if (key && valueParts.length > 0) {
      const value = valueParts.join("=").replace(/^"(.*)"$/, "$1"); // Remove quotes if present
      envVars[key] = value;
    }
  }
});

// Set environment variables
Object.keys(envVars).forEach((key) => {
  process.env[key] = envVars[key];
});

console.log(`🔄 Generating Prisma client for ${env} environment...`);
console.log(`📄 Using environment file: ${envFile}`);
console.log(`🗄️  Database URL: ${process.env.DATABASE_URL ? process.env.DATABASE_URL.replace(/:[^:@]*@/, ":***@") : "Not set"}`);

try {
  // Run prisma generate with the loaded environment variables
  execSync("npx prisma generate --no-engine", {
    stdio: "inherit",
    env: process.env,
    cwd: path.join(__dirname, ".."),
  });

  console.log(`✅ Successfully generated Prisma client for ${env} environment!`);
} catch (error) {
  console.error(`❌ Failed to generate Prisma client:`, error.message);
  process.exit(1);
}
