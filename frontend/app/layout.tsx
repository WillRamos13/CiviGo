import type { Metadata, Viewport } from "next";
import { AuthProvider } from '@/components/AuthProvider';
import { ThemeProvider } from '@/components/ThemeProvider';
import Shell from '@/components/Shell';
import PerformanceTelemetry from '@/components/PerformanceTelemetry';
import ProductAnalytics from '@/components/ProductAnalytics';
import { THEME_BOOTSTRAP_SCRIPT } from '@/lib/theme';
import "./globals.css";
export const metadata: Metadata = {
    metadataBase:new URL('https://civigo.online'),
    applicationName: 'CiviGo',
    title: { default: 'CiviGo · Tu ciudad más segura', template: '%s · CiviGo' },
    description: 'Reportes ciudadanos y recorridos informados para la provincia de Ica.',
    openGraph:{type:'website',locale:'es_PE',siteName:'CiviGo',title:'CiviGo · Tu ciudad más segura',description:'Explora Ica, consulta reportes ciudadanos y compara tus recorridos.',images:[{url:'/civigo-spot-poster.jpg',width:1920,height:1080,alt:'Conoce CiviGo'}]},
    twitter:{card:'summary_large_image',title:'CiviGo · Tu ciudad más segura',images:['/civigo-spot-poster.jpg']},
};
export const viewport: Viewport = { themeColor: '#1554d8' };
export default function RootLayout({ children }: {children:React.ReactNode}) {
    return (<html lang="es" suppressHydrationWarning>
      <head><script id="civigo-theme-init" dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP_SCRIPT }} /></head>
      <body><ThemeProvider><AuthProvider><PerformanceTelemetry/><ProductAnalytics/><Shell>{children}</Shell></AuthProvider></ThemeProvider></body>
    </html>);
}
