'use client';

import { useEffect, useId, useState, type KeyboardEvent } from 'react';
import { api } from '@/lib/api';
import { normalizePlaceQuery, startPlaceSearch, type PlaceResult, type PlaceSearchState } from '@/lib/place-search';

export default function PlaceInput({ label, value, onChange }: {
    label: string;
    value: PlaceResult | null;
    onChange: (value: PlaceResult | null) => void;
}) {
    const id = useId();
    const listId = `${id}-places`, statusId = `${id}-status`;
    const [query, setQuery] = useState('');
    const [search, setSearch] = useState<PlaceSearchState>({ query: '', status: 'idle', results: [], error: '' });
    const [open, setOpen] = useState(false), [active, setActive] = useState(-1);
    const normalized = normalizePlaceQuery(query);
    const eligible = !value && normalized.length >= 3;
    const currentSearch = search.query === normalized;
    const results = eligible && currentSearch ? search.results : [];
    const expanded = open && results.length > 0;
    const selected = expanded && active >= 0 && active < results.length ? active : -1;
    const searching = eligible && (!currentSearch || search.status === 'loading');
    const error = eligible && currentSearch && search.status === 'error' ? search.error : '';

    useEffect(() => {
        if (value) return;
        return startPlaceSearch(normalized, async (text, signal) => {
            const deadline = AbortSignal.timeout(15000);
            try {
                return await api<unknown>(`/navigation/places?q=${encodeURIComponent(text)}`, { signal: AbortSignal.any([signal, deadline]) });
            } catch (error) {
                if (deadline.aborted && !signal.aborted) throw new Error('La búsqueda tardó demasiado. Inténtalo de nuevo.');
                throw error;
            }
        }, setSearch);
    }, [normalized, value]);
    useEffect(() => {
        if (expanded && selected >= 0) document.getElementById(`${listId}-${selected}`)?.scrollIntoView({ block: 'nearest' });
    }, [expanded, selected, listId]);

    const choose = (place: PlaceResult) => {
        onChange(place);
        setQuery('');
        setOpen(false);
        setActive(-1);
    };
    const navigate = (event: KeyboardEvent<HTMLInputElement>) => {
        if (event.nativeEvent.isComposing) return;
        if (event.key === 'Escape') {
            event.preventDefault();
            setOpen(false);
            setActive(-1);
        } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            if (!results.length) return;
            event.preventDefault();
            const next = event.key === 'ArrowDown'
                ? (selected + 1) % results.length
                : selected <= 0 ? results.length - 1 : selected - 1;
            setOpen(true);
            setActive(next);
        } else if (event.key === 'Enter') {
            // A pending place search must not submit the surrounding route panel.
            event.preventDefault();
            if (selected >= 0) choose(results[selected]);
        }
    };

    return <div className="field autocomplete" onBlur={event => {
        if (!event.currentTarget.contains(event.relatedTarget)) {
            setOpen(false);
            setActive(-1);
        }
    }}>
        <label htmlFor={id}>{label}</label>
        <input id={id} aria-label={label} role="combobox" aria-autocomplete="list"
            aria-expanded={expanded} aria-controls={expanded ? listId : undefined}
            aria-activedescendant={selected >= 0 ? `${listId}-${selected}` : undefined}
            aria-describedby={open && eligible ? statusId : undefined}
            value={value?.nombre ?? query} placeholder="Buscar dirección o lugar" autoComplete="off" maxLength={160}
            onFocus={() => setOpen(true)} onKeyDown={navigate}
            onChange={event => {
                onChange(null);
                const text = event.target.value, nextQuery = normalizePlaceQuery(text);
                setQuery(text);
                if (nextQuery !== normalized || value) {
                    setSearch({ query: nextQuery, status: nextQuery.length >= 3 ? 'loading' : 'idle', results: [], error: '' });
                }
                setOpen(true);
                setActive(-1);
            }} />
        {expanded && <div className="search-results" id={listId} role="listbox" aria-label={`Lugares para ${label.toLowerCase()}`}>
            {results.map((place, index) => <button type="button" role="option" tabIndex={-1}
                id={`${listId}-${index}`} key={`${place.nombre}-${place.latitud}-${place.longitud}`}
                aria-selected={selected === index} onPointerDown={event => event.preventDefault()}
                onClick={() => choose(place)}
                style={selected === index ? { background: 'var(--surface-hover)' } : undefined}>
                <span>{place.nombre}</span>
                {place.descripcion && <small className="muted" style={{ display: 'block', marginTop: 3 }}>{place.descripcion}</small>}
            </button>)}
        </div>}
        {open && eligible && <small id={statusId} role="status" aria-live="polite"
            style={error ? { color: '#b45309' } : undefined}>
            {searching ? 'Buscando lugares…' : error || (results.length
                ? `${results.length} lugar${results.length === 1 ? '' : 'es'} disponible${results.length === 1 ? '' : 's'}. Usa las flechas y Enter para seleccionar.`
                : 'No encontramos ese lugar. Prueba otro nombre o ingresa coordenadas.')}
        </small>}
    </div>;
}
