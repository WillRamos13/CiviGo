import React from 'react';
import { Map, FileText, Plus, Bell, User } from 'lucide-react';
import { triggerHaptic } from '../../services/native';

export type TabId = 'map' | 'reports' | 'report' | 'alerts' | 'profile';

interface BottomNavigationProps {
  activeTab: TabId;
  onChangeTab: (tab: TabId) => void;
  unreadAlertsCount?: number;
}

export const BottomNavigation: React.FC<BottomNavigationProps> = ({
  activeTab,
  onChangeTab,
  unreadAlertsCount = 0,
}) => {
  const handleTabClick = (tab: TabId) => {
    void triggerHaptic(tab === 'report' ? 'medium' : 'light');
    onChangeTab(tab);
  };

  return (
    <nav className="bottom-nav" aria-label="Navegación principal">
      <button
        type="button"
        className={`nav-tab ${activeTab === 'map' ? 'active' : ''}`}
        onClick={() => handleTabClick('map')}
        aria-label="Explorar Mapa"
      >
        <div className="tab-icon-wrap">
          <Map size={20} />
        </div>
        <span>Mapa</span>
      </button>

      <button
        type="button"
        className={`nav-tab ${activeTab === 'reports' ? 'active' : ''}`}
        onClick={() => handleTabClick('reports')}
        aria-label="Mis Reportes"
      >
        <div className="tab-icon-wrap">
          <FileText size={20} />
        </div>
        <span>Reportes</span>
      </button>

      <button
        type="button"
        className={`nav-tab tab-report ${activeTab === 'report' ? 'active' : ''}`}
        onClick={() => handleTabClick('report')}
        aria-label="Reportar incidente nuevo"
      >
        <div className="tab-report-fab">
          <Plus size={24} strokeWidth={2.6} />
        </div>
        <span>Reportar</span>
      </button>

      <button
        type="button"
        className={`nav-tab ${activeTab === 'alerts' ? 'active' : ''}`}
        onClick={() => handleTabClick('alerts')}
        aria-label="Alertas y avisos"
      >
        <div className="tab-icon-wrap">
          <Bell size={20} />
          {unreadAlertsCount > 0 && (
            <span
              style={{
                position: 'absolute',
                top: -4,
                right: -6,
                background: 'var(--brand-solid)',
                color: '#fff',
                fontSize: 9,
                fontWeight: 700,
                borderRadius: '50%',
                width: 14,
                height: 14,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              {unreadAlertsCount > 9 ? '9+' : unreadAlertsCount}
            </span>
          )}
        </div>
        <span>Alertas</span>
      </button>

      <button
        type="button"
        className={`nav-tab ${activeTab === 'profile' ? 'active' : ''}`}
        onClick={() => handleTabClick('profile')}
        aria-label="Mi Perfil"
      >
        <div className="tab-icon-wrap">
          <User size={20} />
        </div>
        <span>Perfil</span>
      </button>
    </nav>
  );
};
