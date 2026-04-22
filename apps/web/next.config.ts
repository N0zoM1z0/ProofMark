import type { NextConfig } from 'next';

function buildContentSecurityPolicy() {
  const connectSources = Array.from(
    new Set([
      "'self'",
      process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001',
      'http://localhost:3001',
      'http://127.0.0.1:3001',
      'https://snark-artifacts.pse.dev'
    ])
  );
  const scriptSources =
    process.env.NODE_ENV === 'development'
      ? ["'self'", "'unsafe-eval'", "'wasm-unsafe-eval'", "'unsafe-inline'"]
      : ["'self'", "'wasm-unsafe-eval'", "'unsafe-inline'"];

  return [
    "default-src 'self'",
    `connect-src ${connectSources.join(' ')}`,
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "img-src 'self' data: blob:",
    "object-src 'none'",
    `script-src ${scriptSources.join(' ')}`,
    "style-src 'self' 'unsafe-inline'",
    "worker-src 'self' blob:"
  ].join('; ');
}

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  transpilePackages: ['@proofmark/shared', '@proofmark/zk-semaphore'],
  headers() {
    return [
      {
        headers: [
          {
            key: 'Content-Security-Policy',
            value: buildContentSecurityPolicy()
          },
          {
            key: 'Cross-Origin-Opener-Policy',
            value: 'same-origin'
          },
          {
            key: 'Referrer-Policy',
            value: 'strict-origin-when-cross-origin'
          },
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff'
          },
          {
            key: 'X-Frame-Options',
            value: 'DENY'
          }
        ],
        source: '/:path*'
      }
    ];
  }
};

export default nextConfig;
