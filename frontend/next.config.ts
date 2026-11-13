import type { NextConfig } from "next";
import { resolveBackendUrl } from './lib/backend-url';
import { webSecurityHeaders } from './lib/security-headers';
import { PRIVATE_ROUTES } from './lib/seo';
const backend = resolveBackendUrl();
const nextConfig: NextConfig = {
    output: 'standalone',
    agentRules: false,
    turbopack: { root: process.cwd() },
    // Keep production builds within the memory available on small hosts/laptops.
    experimental: { cpus: 2 },
    async headers() {
        return [{ source: '/:path*', headers: [...webSecurityHeaders(process.env.NODE_ENV === 'production'),...(process.env.VERCEL_ENV==='preview'?[{key:'X-Robots-Tag',value:'noindex, nofollow'}]:[])] },...PRIVATE_ROUTES.map(route=>({source:`/${route}/:path*`,headers:[{key:'X-Robots-Tag',value:'noindex, nofollow, noarchive'}]})),{source:'/integraciones/:path*',headers:[{key:'Referrer-Policy',value:'no-referrer'}]}];
    },
    async rewrites() {
        return [{ source: '/api/:path*', destination: `${backend}/api/:path*` }];
    },
};
export default nextConfig;
