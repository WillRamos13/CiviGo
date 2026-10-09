import { metersBetween } from './navigation';
import { isPosition } from './route-cache';
import type { Incidente, Posicion } from './types';

export const RECENT_INCIDENT_RADIUS_METERS = 1000;
export const RECENT_INCIDENT_LIMIT = 10;

function publicationTime(incident: Incidente) {
    // Older API responses may have only a creation date. Event dates describe
    // when something happened, not when the report became available.
    for (const date of [incident.fechaPublicacion, incident.fechaCreacion, incident.creadoEn, incident.fecha]) {
        if (!date) continue;
        const time = Date.parse(date);
        if (Number.isFinite(time)) return time;
    }
    return 0;
}

/** Pass incidents already filtered by type; this does not limit the map itself. */
export function recentNearbyIncidents(incidents: readonly Incidente[], position: Posicion | null | undefined): Incidente[] {
    if (!isPosition(position)) return [];
    return incidents
        .filter(incident => incident.publicado !== false && isPosition(incident) && metersBetween(position, incident) <= RECENT_INCIDENT_RADIUS_METERS)
        .sort((a, b) => publicationTime(b) - publicationTime(a) || b.id - a.id)
        .slice(0, RECENT_INCIDENT_LIMIT);
}
