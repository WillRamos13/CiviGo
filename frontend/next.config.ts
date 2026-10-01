import type { NextConfig } from "next";
const nextConfig: NextConfig = {
    output: 'standalone',
    turbopack: { root: process.cwd() },
    async rewrites() {
        const backend = (process.env.BACKEND_URL || 'http://127.0.0.1:4000').replace(/\/$/, '');
        return [{ source: '/api/:path*', destination: `${backend}/api/:path*` }];
    },
};
export default nextConfig;
