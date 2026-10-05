
import bache from '@/iconos/bache.png';
import basura from '@/iconos/basura.png';
import calleBloqueada from '@/iconos/calle bloqueada.png';
import choque from '@/iconos/choque.png';
import derrumbe from '@/iconos/derrumbe.png';
import desaparecido from '@/iconos/desaparecido.png';
import disturbios from '@/iconos/disturbios.png';
import gas from '@/iconos/gas.png';
import iluminacion from '@/iconos/iluminacion.png';
import incendio from '@/iconos/incendio.png';
import intentoDeRobo from '@/iconos/intento de robo.png';
import inundacion from '@/iconos/inundacion.png';
import robo from '@/iconos/robo.png';
import semaforo from '@/iconos/semaforo.png';
import sospechoso from '@/iconos/sospechoso.png';

type IncidentIconAsset = { image: string; scale?: number };

const icons = new Map<string, IncidentIconAsset>([
    ['bache', { image: bache }],
    ['basura-acumulada', { image: basura }],
    // The supplied barrier has wide transparent margins. Frame it with CSS;
    // keep the original file unchanged.
    ['calle-bloqueada', { image: calleBloqueada, scale: 3.5 }],
    ['accidente-vehicular', { image: choque }],
    ['derrumbe', { image: derrumbe }],
    ['persona-desaparecida', { image: desaparecido }],
    ['disturbio', { image: disturbios }],
    ['fuga-de-gas', { image: gas }],
    ['mala-iluminacion', { image: iluminacion }],
    ['incendio', { image: incendio }],
    ['intento-de-robo', { image: intentoDeRobo }],
    ['inundacion', { image: inundacion }],
    ['robo', { image: robo }],
    ['semaforo-danado', { image: semaforo }],
    ['persona-sospechosa', { image: sospechoso }],
]);

export function getIncidentIcon(...types: (string | undefined)[]) {
    for (const type of types) {
        const key = type?.trim().toLowerCase().normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '').replace(/[\s_]+/g, '-');
        const icon = key ? icons.get(key) : undefined;
        if (icon) return icon;
    }
    return undefined;
}

