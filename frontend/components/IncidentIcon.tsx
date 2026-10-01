import Image from 'next/image';
import { MapPin } from 'lucide-react';
import { getIncidentIcon } from '@/lib/incident-icons';

type Props = { tipo?: string; slug?: string; size?: number; className?: string };

export default function IncidentIcon({ tipo, slug, size = 40, className = '' }: Props) {
    const asset = getIncidentIcon(slug, tipo);
    const scale = asset?.scale ?? 1;
    const width = Math.round(size * scale);
    return <span className={`incident-type-icon ${className}`.trim()} style={{ width: size, height: size }} aria-hidden="true">
        {asset ? <Image src={asset.image} alt="" width={width} height={Math.round(width * asset.image.height / asset.image.width)} sizes={`${width}px`} style={{ transform: `scale(${scale})` }} />
            : <MapPin size={Math.round(size * .55)} />}
    </span>;
}
