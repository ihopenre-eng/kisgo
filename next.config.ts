import type { NextConfig } from 'next';

const pagesBasePath = process.env.GITHUB_PAGES_BASE_PATH ?? '';
const nextConfig: NextConfig = {
  ...(process.env.GITHUB_PAGES === 'true'
    ? {
        output: 'export',
        assetPrefix: pagesBasePath || undefined,
        trailingSlash: true,
      }
    : {}),
};

export default nextConfig;
