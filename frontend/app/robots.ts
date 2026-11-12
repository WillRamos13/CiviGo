import type {MetadataRoute} from 'next';
import {SITE_ORIGIN,PRIVATE_ROUTES} from '@/lib/seo';
export default function robots():MetadataRoute.Robots{return {rules:{userAgent:'*',allow:'/',disallow:process.env.VERCEL_ENV==='preview'?['/']:PRIVATE_ROUTES.map(route=>'/'+route)},sitemap:SITE_ORIGIN+'/sitemap.xml'};}
