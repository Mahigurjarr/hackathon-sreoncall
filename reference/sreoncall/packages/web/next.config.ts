import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  output: 'standalone',
  // Remove X-Powered-By fingerprint (security: CWE-200)
  poweredByHeader: false,
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '*.sreoncall.com',
      },
      {
        protocol: 'https',
        hostname: 'avatars.githubusercontent.com',
      },
      {
        protocol: 'https',
        hostname: 'lh3.googleusercontent.com',
      },
      {
        protocol: 'https',
        hostname: '**',
      },
    ],
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=31536000; includeSubDomains; preload',
          },
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff',
          },
          {
            key: 'X-Frame-Options',
            value: 'SAMEORIGIN',
          },
          {
            key: 'Referrer-Policy',
            value: 'strict-origin-when-cross-origin',
          },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=(), interest-cohort=()',
          },
          // NOTE: Content-Security-Policy is set per-request by middleware.ts
          // (nonce-based, enforced). Do NOT also send it from here — the
          // middleware policy must win.
        ],
      },
    ];
  },
  async rewrites() {
    return [
      {
        source: '/api/v1/:path*',
        destination: `${process.env.INTERNAL_API_URL || 'http://127.0.0.1:8000'}/api/v1/:path*`,
      },
    ];
  },
};

export default nextConfig;
