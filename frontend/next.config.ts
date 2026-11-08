import type { NextConfig } from "next";
import { resolveBackendUrl } from './lib/backend-url';
const backend = resolveBackendUrl();
const nextConfig: NextConfig = {
    output: 'standalone',
    agentRules: false,
    turbopack: { root: process.cwd() },
    // Keep production builds within the memory available on small hosts/laptops.
    experimental: { cpus: 2 },
    async rewrites() {
        return [{ source: '/api/:path*', destination: `${backend}/api/:path*` }];
    },
};
export default nextConfig;
