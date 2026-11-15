import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  devIndicators: false,
  // Rewrites buffer request bodies too; preserve the API's full 20 MiB originals.
  experimental: {
    proxyClientMaxBodySize: 20 * 1024 * 1024,
    // Commands return durable receipts; model execution runs outside HTTP requests.
    proxyTimeout: 30000,
  },
  async headers() {
    return [
      {
        source: "/",
        headers: [
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          {
            key: "Content-Security-Policy",
            value: "frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
          },
        ],
      },
    ];
  },
  async rewrites() {
    return [{ source: "/api/:path*", destination: "http://127.0.0.1:8000/api/:path*" }];
  },
};

export default nextConfig;
