import type { NextConfig } from "next";

const isVercel = Boolean(process.env.VERCEL);

const nextConfig: NextConfig = {
  // Use standalone only when not on Vercel (e.g. Docker VPS builds)
  ...(isVercel ? {} : { output: "standalone" }),
  serverExternalPackages: ["firebase-admin", "@prisma/client", "prisma"],
  outputFileTracingIncludes: {
    '/**': ['./node_modules/.prisma/client/**/*', './prisma/**/*'],
  },
  // Baseline security headers. The site (incl. admin, staff and payment pages) may not be framed
  // by other sites. A full script CSP is intentionally not set here: the Cashfree checkout SDK
  // must be verified against it in Preview first.
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Content-Security-Policy', value: "frame-ancestors 'none'" },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
    ];
  },
  async redirects() {
    return [
      {
        source: '/privacy',
        destination: '/privacy-policy',
        permanent: true,
      },
      {
        source: '/terms',
        destination: '/terms-and-conditions',
        permanent: true,
      },
      {
        source: '/terms-of-service',
        destination: '/terms-and-conditions',
        permanent: true,
      },
      {
        source: '/refund',
        destination: '/refund-policy',
        permanent: true,
      },
      {
        source: '/cancellation',
        destination: '/refund-policy',
        permanent: true,
      },
      {
        source: '/cancellation-policy',
        destination: '/refund-policy',
        permanent: true,
      },
      {
        source: '/cancellation-refund-policy',
        destination: '/refund-policy',
        permanent: true,
      },
    ];
  },
};

export default nextConfig;
