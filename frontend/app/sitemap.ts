import type {MetadataRoute} from 'next';
import {PUBLIC_PAGES,SITE_ORIGIN} from '@/lib/seo';
export default function sitemap():MetadataRoute.Sitemap{return PUBLIC_PAGES.map(path=>({url:SITE_ORIGIN+path,changeFrequency:path==='/mapa'?'daily':'monthly',priority:path==='/'?1:path==='/mapa'?.9:.5}));}
