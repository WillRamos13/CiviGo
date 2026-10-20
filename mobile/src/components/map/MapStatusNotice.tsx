import React from 'react';
import { ChevronDown } from 'lucide-react';
import './map-status-notice.css';

interface MapStatusNoticeProps {
  title: string;
  children: React.ReactNode;
  onRetry?: () => void;
  retryLabel?: string;
  retryDisabled?: boolean;
}

/** Native disclosure keeps diagnostics/retries available without covering the map. */
export const MapStatusNotice: React.FC<MapStatusNoticeProps> = ({ title, children, onRetry,
  retryLabel = 'Reintentar', retryDisabled = false }) => (
  <details className="map-status-notice" onToggle={event => {
    if (!event.currentTarget.open) return;
    const rail = event.currentTarget.closest('.map-render-status');
    if (!rail) return;
    for (const other of rail.querySelectorAll<HTMLDetailsElement>('.map-status-notice[open]')) {
      if (other !== event.currentTarget) other.open = false;
    }
    rail.scrollTop = 0;
  }}>
    <summary><span>{title}</span><ChevronDown size={12} aria-hidden="true" /></summary>
    <div className="map-status-notice-body" role="status">
      {children}
      {onRetry && <button type="button" className="btn btn-secondary btn-small" disabled={retryDisabled} onClick={onRetry}>{retryLabel}</button>}
    </div>
  </details>
);
