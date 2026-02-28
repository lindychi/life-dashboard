import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  experimental: {
    serverActions: {
      bodySizeLimit: "10mb",
    },
  },
  // Allow larger request bodies for file uploads
  serverExternalPackages: ["pg", "better-sqlite3"],
};

export default nextConfig;
