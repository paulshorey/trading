#!/usr/bin/env node
/**
 * Fetch secrets from Infisical and write to .env files.
 *
 * Required environment variables:
 *   INFISICAL_TOKEN      - Machine identity access token
 *   INFISICAL_PROJECT_ID - Project ID (found in Project Settings or URL)
 *
 * Optional environment variables:
 *   INFISICAL_ENV        - Environment slug (default: "dev")
 *   INFISICAL_SITE_URL   - Custom Infisical instance URL (default: https://app.infisical.com)
 *
 * Usage:
 *   node scripts/fetch-infisical.mjs /m/apps/log apps/log/.env
 *   node scripts/fetch-infisical.mjs --app market-write-node
 *   node scripts/fetch-infisical.mjs --all
 *   pnpm run env:pull -- /m/apps/log apps/log/.env
 *   pnpm run env:pull:all
 */

import { InfisicalSDK } from '@infisical/sdk';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

// App configurations: logical app name -> candidate Infisical paths + local .env path.
// Candidate paths let us migrate app names without breaking existing secret mounts.
const APPS = [
  {
    name: 'log',
    outputFile: 'apps/log/.env',
    infisicalPaths: ['/m/apps/log'],
  },
  {
    name: 'market-view-next',
    outputFile: 'apps/market-view-next/.env',
    infisicalPaths: [
      '/m/apps/market-view-next',
      '/m/apps/market-view-ts',
      '/m/apps/strength',
      '/m/apps/price-ui',
    ],
  },
  {
    name: 'market-write-node',
    outputFile: 'apps/market-write-node/.env',
    infisicalPaths: ['/m/apps/market-write-node', '/m/apps/trade'],
  },
  {
    name: 'tradingview-node',
    outputFile: 'apps/tradingview-node/.env',
    infisicalPaths: ['/m/apps/tradingview-node'],
  },
];

const APPS_BY_NAME = new Map(APPS.map((app) => [app.name, app]));

async function fetchSecrets(infisicalPath, outputFile, options) {
  const { token, projectId, env, siteUrl } = options;

  const client = new InfisicalSDK({
    siteUrl: siteUrl || undefined,
  });

  // Set the access token directly (machine identity token)
  client.auth().accessToken(token);

  // Fetch secrets from the specified path
  const secrets = await client.secrets().listSecrets({
    projectId,
    environment: env,
    secretPath: infisicalPath,
    expandSecretReferences: true,
    includeImports: true,
  });

  // Convert to dotenv format
  const dotenvContent = secrets.secrets
    .map((secret) => `${secret.secretKey}=${secret.secretValue}`)
    .join('\n');

  // Ensure output directory exists
  const fullPath = outputFile.startsWith('/') ? outputFile : resolve(ROOT, outputFile);
  mkdirSync(dirname(fullPath), { recursive: true });

  // Write .env file
  writeFileSync(fullPath, dotenvContent + '\n', 'utf-8');

  console.log(`✓ ${infisicalPath} → ${outputFile} (${secrets.secrets.length} secrets)`);
}

async function fetchAppSecrets(app, options) {
  const errors = [];

  for (const infisicalPath of app.infisicalPaths) {
    try {
      await fetchSecrets(infisicalPath, app.outputFile, options);
      return;
    } catch (error) {
      errors.push(`${infisicalPath}: ${error.message}`);
    }
  }

  throw new Error(errors.join(' | '));
}

async function main() {
  const token = process.env.INFISICAL_TOKEN;
  const projectId = process.env.INFISICAL_PROJECT_ID;
  const env = process.env.INFISICAL_ENV || 'dev';
  const siteUrl = process.env.INFISICAL_SITE_URL;

  if (!token) {
    console.error('Error: INFISICAL_TOKEN environment variable is required.');
    console.error('Set it to your machine identity access token.');
    process.exit(1);
  }

  if (!projectId) {
    console.error('Error: INFISICAL_PROJECT_ID environment variable is required.');
    console.error('Find it in Project Settings or in the URL: https://app.infisical.com/project/{projectId}/...');
    process.exit(1);
  }

  const args = process.argv.slice(2);
  const options = { token, projectId, env, siteUrl };

  const appFlagIndex = args.indexOf('--app');
  const appName = appFlagIndex === -1 ? undefined : args[appFlagIndex + 1];

  if (appFlagIndex !== -1) {
    if (!appName) {
      console.error('Usage: fetch-infisical.mjs --app <app-name>');
      console.error(`Known apps: ${APPS.map((app) => app.name).join(', ')}`);
      process.exit(1);
    }

    const app = APPS_BY_NAME.get(appName);
    if (!app) {
      console.error(`Unknown app "${appName}".`);
      console.error(`Known apps: ${APPS.map((knownApp) => knownApp.name).join(', ')}`);
      process.exit(1);
    }

    await fetchAppSecrets(app, options);
    return;
  }

  // Handle --all flag to fetch all apps
  if (args.includes('--all') || args.length === 0) {
    console.log(`Fetching secrets for all apps (env: ${env})...\n`);
    for (const app of APPS) {
      try {
        await fetchAppSecrets(app, options);
      } catch (error) {
        console.error(`✗ ${app.name}: ${error.message}`);
      }
    }
  } else {
    // Single app: fetch-infisical.mjs <infisical-path> <output-file>
    const [infisicalPath, outputFile] = args;
    if (!infisicalPath || !outputFile) {
      console.error('Usage: fetch-infisical.mjs <infisical-path> <output-file>');
      console.error('       fetch-infisical.mjs --app <app-name>');
      console.error('       fetch-infisical.mjs --all');
      console.error('Example: fetch-infisical.mjs /m/apps/log apps/log/.env');
      process.exit(1);
    }
    await fetchSecrets(infisicalPath, outputFile, options);
  }
}

main().catch((error) => {
  console.error('Error:', error.message);
  process.exit(1);
});
