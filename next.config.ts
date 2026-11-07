import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  eslint: {
    // Prevents ESLint warnings/formatting rules from halting production builds
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;