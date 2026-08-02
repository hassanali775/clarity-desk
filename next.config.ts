// next.config.ts
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverComponentsExternalPackages: ['pdfjs-dist'],
  },
  outputFileTracingIncludes: {
    '/api/**/*': ['./node_modules/pdfjs-dist/standard_fonts/**/*'],
  },
};

export default nextConfig;