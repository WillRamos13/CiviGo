import { useEffect, useState } from 'react';
import { previewImage, errorMessage } from '@/lib/api';

export default function AnnouncementImagePreview({ id, alt }: { id: string; alt: string }) {
  const [source, setSource] = useState(''), [failure, setFailure] = useState('');
  useEffect(() => {
    let active = true;
    setSource(''); setFailure('');
    void previewImage(id).then(image => { if (active) setSource(image.dataUrl); }).catch(error => { if (active) setFailure(errorMessage(error)); });
    return () => { active = false; };
  }, [id]);
  return <div className="announcement-image-preview">
    {source ? <img src={source} alt={alt} style={{ display: 'block', width: '100%', maxHeight: 180, objectFit: 'contain', borderRadius: 8 }} /> : <p className="muted text-sm" role="status">{failure || 'Cargando vista previa…'}</p>}
  </div>;
}
