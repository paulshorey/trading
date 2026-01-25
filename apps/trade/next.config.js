const baseConfig = require('@lib/config/next/base')

/** @type {import('next').NextConfig} */
const nextConfig = {
  ...baseConfig,
  // Next.js 14.2+ uses serverExternalPackages (not experimental.serverComponentsExternalPackages)
  // Prevent Next.js from bundling DYDX - it has static methods and crypto modules
  // that don't work correctly when bundled/tree-shaken
  serverExternalPackages: ['@dydxprotocol/v4-client-js'],
  experimental: {
    // Keep the old config for backwards compatibility during migration
    serverComponentsExternalPackages: ['@dydxprotocol/v4-client-js'],
  },
  webpack: (config, { isServer }) => {
    // Additional externalization for server-side builds
    if (isServer) {
      config.externals = config.externals || []
      config.externals.push('@dydxprotocol/v4-client-js')
    }
    return config
  },
}

module.exports = nextConfig
