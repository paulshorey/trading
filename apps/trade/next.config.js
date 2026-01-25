const baseConfig = require('@lib/config/next/base')

/** @type {import('next').NextConfig} */
const nextConfig = {
  ...baseConfig,
  experimental: {
    // Prevent Next.js from bundling DYDX - it has static methods and crypto modules
    // that don't work correctly when bundled/tree-shaken
    serverComponentsExternalPackages: ['@dydxprotocol/v4-client-js'],
  },
}

module.exports = nextConfig
