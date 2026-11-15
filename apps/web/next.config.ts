import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  devIndicators: false,
  // Rewrites buffer request bodies too; preserve the API's full 20 MiB originals.
  experimental: { proxyClientMaxBodySize: 20 * 1024 * 1024 },
  async rewrites() {
    return [{ source: "/api/:path*", destination: "http://127.0.0.1:8000/api/:path*" }];
  },
};

export default nextConfig;
