'use client';
import { useEffect, useState, useId } from 'react';
import { api, errorMessage } from '@/lib/api';
import type { Posicion } from '@/lib/types';
import { isPosition } from '@/lib/route-cache';
export default function PlaceInput({ label, value, onChange }: {
    label: string;
    value: (Posicion & {
        nombre: string;
    }) | null;
    onChange: (value: (Posicion & {
        nombre: string;
    }) | null) => void;
}) {
    const id = useId();
    const [query, setQuery] = useState(''), [results, setResults] = useState<(Posicion & {
        nombre: string;
    })[]>([]), [error, setError] = useState(''), [searching, setSearching] = useState(false);
    useEffect(() => { if (value || query.trim().length < 3)
        return; let active = true; const controller = new AbortController(); const timer = setTimeout(() => { setSearching(true); api<(Posicion & {
        nombre: string;
    })[]>(`/navigation/places?q=${encodeURIComponent(query)}`, { signal: controller.signal }).then(d => { if (active) {
        setResults(d.filter(item => isPosition(item) && typeof item.nombre === 'string'));
        setError('');
    } }).catch(e => { if (active)
        setError(errorMessage(e)); }).finally(() => { if (active)
        setSearching(false); }); }, 350); return () => { active = false; clearTimeout(timer); controller.abort(); }; }, [query, value]);
    return <div className="field autocomplete"><label htmlFor={id}>{label}</label><input id={id} aria-label={label} value={value?.nombre ?? query} placeholder="Buscar dirección o lugar" autoComplete="off" onChange={e => { onChange(null); setQuery(e.target.value); setResults([]); setError(''); setSearching(e.target.value.trim().length >= 3); }}/>{query.length >= 3 && !value && (results.length > 0 ? <div className="search-results">{results.map((r, i) => <button type="button" key={`${r.nombre}-${i}`} onClick={() => { onChange(r); setResults([]); setQuery(''); }}>{r.nombre}</button>)}</div> : searching ? <small>Buscando lugares…</small> : !error && <small>No hay resultados disponibles. Puedes usar coordenadas.</small>)}{error && !value && <small style={{ color: '#b45309' }}>{error}</small>}</div>;
}
