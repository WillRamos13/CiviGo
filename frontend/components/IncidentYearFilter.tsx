import { LAST_YEAR, toggleIncidentYear, type IncidentYearControl } from '@/lib/incident-years';
import styles from './IncidentYearFilter.module.css';
export default function IncidentYearFilter({ options, selected, onChange }: IncidentYearControl) {
    return <fieldset className={styles.filter}>
        <legend>Antigüedad de los reportes</legend><label><input type="checkbox" checked={selected?.includes(LAST_YEAR)===true} onChange={()=>onChange(selected?.includes(LAST_YEAR)?[]:[LAST_YEAR])}/>Últimos 12 meses</label>
        <label><input type="checkbox" checked={selected === null} onChange={() => onChange(selected === null ? [] : null)}/>Todos los años</label>
        <div className={styles.years}>{options.map(year => <label key={year}>
            <input type="checkbox" checked={selected === null || selected.includes(year)} onChange={() => onChange(toggleIncidentYear(selected, year, options))}/>
            {year === 'sin-fecha' ? 'Sin fecha' : year}
        </label>)}</div>
        <small>{selected?.length === 0 ? 'No has seleccionado ningún año.' : 'Puedes marcar varios años. Se usa la fecha del hecho en Perú.'}</small>
    </fieldset>;
}
