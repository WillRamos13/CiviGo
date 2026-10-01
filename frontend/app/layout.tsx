import type { Metadata, Viewport } from "next";
import { AuthProvider } from '@/components/AuthProvider';
import { ThemeProvider } from '@/components/ThemeProvider';
import Shell from '@/components/Shell';
import { THEME_BOOTSTRAP_SCRIPT } from '@/lib/theme';
import "./globals.css";
export const metadata: Metadata = {
    applicationName: 'CiviGo',
    title: { default: 'CiviGo · Tu ciudad, mejor conectada', template: '%s · CiviGo' },
    description: 'Reportes ciudadanos y recorridos informados para la provincia de Ica.',
};
export const viewport: Viewport = { themeColor: '#1554d8' };
export default function RootLayout({ children }: LayoutProps<"/">) {
    return (<html lang="es" suppressHydrationWarning>
      <head><script id="civigo-theme-init" dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP_SCRIPT }} /></head>
      <body><ThemeProvider><AuthProvider><Shell>{children}</Shell></AuthProvider></ThemeProvider></body>
    </html>);
}
