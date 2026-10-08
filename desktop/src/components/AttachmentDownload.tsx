import { useRef, useState } from 'react';
import { downloadAttachment, errorMessage } from '@/lib/api';

export default function AttachmentDownload({ id, children, className = 'btn btn-secondary text-sm' }: {
  id: string;
  children: React.ReactNode;
  className?: string;
}) {
  const active = useRef(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  async function download() {
    if (active.current) return;
    active.current = true;
    setPending(true);
    setError('');
    setSaved(false);
    try {
      const result = await downloadAttachment(id);
      setSaved(result.guardado === true);
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      active.current = false;
      setPending(false);
    }
  }
  return <div>
    <button type="button" className={className} disabled={pending} onClick={download}>{pending ? 'Descargando…' : children}</button>
    {error && <p className="notice notice-error mt-2" role="alert">{error}</p>}
    {saved && <p className="muted text-sm mt-2" role="status">Archivo guardado.</p>}
  </div>;
}
