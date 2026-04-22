import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@proofmark/shared', '@proofmark/zk-semaphore']
};

export default nextConfig;
