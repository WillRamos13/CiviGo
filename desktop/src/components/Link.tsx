import { useState } from 'react';
import { unwrap } from '@/lib/api';
export default function Link({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) {
  const [error, setError] = useState('');
  return <><a {...props} href={href} onClick={event => {
    event.preventDefault(); setError('');
    void window.civigoDesktop.openPublic(href).then(unwrap).catch(error => setError(error instanceof Error ? error.message : 'Enlace no disponible.'));
  }}>{children}</a>{error && <span className="notice notice-error" role="alert">{error}</span>}</>;
}
