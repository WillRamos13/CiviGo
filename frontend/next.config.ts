import type { NextConfig } from "next";
import { resolveBackendUrl } from './lib/backend-url';
const backend = resolveBackendUrl();
const nextConfig: NextConfig = {
    output: 'standalone',
    turbopack: { root: process.cwd() },
    async rewrites() {
        return [{ source: '/api/:path*', destination: `${backend}/api/:path*` }];
    },
};
export default nextConfig;
