/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ['@apps/data'],
  reactStrictMode: false,
  eslint: {
    ignoreDuringBuilds: true,
  },
  optimizePackageImports: ['@mantine/core', '@mantine/hooks'],
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'i.ytimg.com',
        port: '',
        pathname: '**',
      },
      {
        protocol: 'https',
        hostname: 'img.youtube.com',
        port: '',
        pathname: '**',
      },
    ],
  },
}

module.exports = nextConfig
