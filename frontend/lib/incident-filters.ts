import type {Catalogo, Incidente} from './types';

export interface IncidentFilterGroup {
    key: string;
    name: string;
    types: {key: string; name: string}[];
}

function slug(value: string | undefined) {
    return (value ?? '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
        .toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

export function incidentTypeKey(incident: Pick<Incidente, 'tipo' | 'tipoNombre' | 'tipoSlug'>): string {
    return slug(incident.tipoSlug) || slug(incident.tipoNombre) || slug(incident.tipo) || 'sin-tipo';
}

export function buildIncidentFilterGroups(
    catalog: Catalogo | null,
    incidents: Incidente[],
    selected?: {key: string; name: string},
): IncidentFilterGroup[] {
    const groups = new Map<string, IncidentFilterGroup>();
    const knownTypes = new Set<string>();
    for (const category of catalog?.categorias ?? []) {
        const key = slug(category.slug) || slug(category.nombre) || `categoria-${category.id}`;
        let group = groups.get(key);
        for (const type of category.tipos) {
            const typeKey = slug(type.slug) || slug(type.nombre) || 'sin-tipo';
            if (knownTypes.has(typeKey)) continue;
            if (!group) {
                group = {key, name: category.nombre.trim() || 'Otros incidentes', types: []};
                groups.set(key, group);
            }
            group.types.push({key: typeKey, name: type.nombre.trim() || type.slug || 'Sin tipo'});
            knownTypes.add(typeKey);
        }
    }
    let others = groups.get('otros-incidentes');
    for (const incident of incidents) {
        const key = incidentTypeKey(incident);
        if (knownTypes.has(key)) continue;
        if (!others) {
            others = {key: 'otros-incidentes', name: 'Otros incidentes', types: []};
            groups.set(others.key, others);
        }
        const name = incident.tipoNombre?.trim() || incident.tipo.trim()
            || incident.tipoSlug?.trim().replaceAll('-', ' ') || 'Sin tipo';
        others.types.push({key, name});
        knownTypes.add(key);
    }
    const selectedKey = slug(selected?.key);
    if (selectedKey && !knownTypes.has(selectedKey)) {
        if (!others) {
            others = {key: 'otros-incidentes', name: 'Otros incidentes', types: []};
            groups.set(others.key, others);
        }
        others.types.push({key: selectedKey, name: selected?.name.trim() || selectedKey.replaceAll('-', ' ')});
    }
    return [...groups.values()];
}

export function filterIncidentsByType(incidents: Incidente[], type: string): Incidente[] {
    const key = slug(type);
    return key ? incidents.filter(incident => incidentTypeKey(incident) === key) : incidents;
}
