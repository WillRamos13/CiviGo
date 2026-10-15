import React from 'react';
import { ArrowLeft, Moon, Sun, Shield } from 'lucide-react';
import { useTheme } from '../../hooks/useTheme';
import { useAuth } from '../../hooks/useAuth';
import { triggerHaptic } from '../../services/native';

interface MobileHeaderProps {
  title?: string;
  showBack?: boolean;
  onBack?: () => void;
  onOpenAgent?: () => void;
}

export const MobileHeader: React.FC<MobileHeaderProps> = ({
  title,
  showBack = false,
  onBack,
  onOpenAgent,
}) => {
  const { toggleTheme, isDark } = useTheme();
  const { usuario } = useAuth();
  const isAgent = usuario?.rol?.toUpperCase() === 'AGENTE';

  const handleToggleTheme = () => {
    void triggerHaptic('light');
    toggleTheme();
  };

  return (
    <header className="mobile-header">
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        {showBack ? (
          <button
            type="button"
            className="icon-btn"
            aria-label="Volver"
            onClick={() => {
              void triggerHaptic('light');
              onBack?.();
            }}
          >
            <ArrowLeft size={20} />
          </button>
        ) : null}

        <div className="brand-title">
          <img
            src="/civigo-logo.jpeg"
            alt="CiviGo Logo"
            className="header-logo"
            onError={(e) => {
              (e.target as HTMLElement).style.display = 'none';
            }}
          />
          <span>
            {title ? title : <>Civi<span className="brand-go">Go</span></>}
          </span>
        </div>
      </div>

      <div className="header-right">
        {isAgent && onOpenAgent && (
          <button
            type="button"
            className="btn btn-secondary btn-small"
            style={{ padding: '4px 8px', fontSize: 11, display: 'flex', alignItems: 'center', gap: 4 }}
            onClick={() => {
              void triggerHaptic('light');
              onOpenAgent();
            }}
          >
            <Shield size={14} color="var(--brand)" />
            <span>Agente</span>
          </button>
        )}

        <button
          type="button"
          className="icon-btn"
          aria-label={isDark ? 'Modo claro' : 'Modo oscuro'}
          onClick={handleToggleTheme}
        >
          {isDark ? <Sun size={19} color="#ffd78e" /> : <Moon size={19} />}
        </button>
      </div>
    </header>
  );
};
