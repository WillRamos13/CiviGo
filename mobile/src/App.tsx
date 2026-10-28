import React, { useState, useEffect, useCallback, useRef } from 'react';
import { AuthProvider } from './hooks/useAuth';
import { ThemeProvider } from './hooks/useTheme';
import { MobileHeader } from './components/layout/MobileHeader';
import {MobileAnnouncements} from './components/layout/MobileAnnouncements';
import { BottomNavigation, type TabId } from './components/layout/BottomNavigation';
import { onHardwareBackButton, triggerHaptic, minimizeAndroidApp } from './services/native';
import { handleAppBack } from './services/backNavigation';
import { IncidentFromAlert } from './components/incident/IncidentFromAlert';
import { isPasswordResetLocation } from './services/password-recovery';

// Pages
import { MapPage } from './pages/MapPage';
import { ReportPage } from './pages/ReportPage';
import { MyReportsPage } from './pages/MyReportsPage';
import { AlertsPage } from './pages/AlertsPage';
import { ProfilePage } from './pages/ProfilePage';
import { CommunityPage } from './pages/CommunityPage';
import { AgentPage } from './pages/AgentPage';
import { LoginPage } from './pages/LoginPage';
import { RegisterPage } from './pages/RegisterPage';
import { ForgotPasswordPage } from './pages/ForgotPasswordPage';
import { VerifyEmailPage } from './pages/VerifyEmailPage';

type ViewMode =
  | 'tab'
  | 'login'
  | 'register'
  | 'forgot'
  | 'verify'
  | 'agent'
  | 'community';

export const AppContent: React.FC = () => {
  const [activeTab, setActiveTab] = useState<TabId>('map');
  const [viewMode, setViewMode] = useState<ViewMode>(() => isPasswordResetLocation(window.location.href) ? 'forgot' : 'tab');
  const [viewHistory, setViewHistory] = useState<ViewMode[]>([]);
  const [notificationIncidentId, setNotificationIncidentId] = useState<number | null>(null);
  const [navigationActive, setNavigationActive] = useState(false);
  const mapVisible = viewMode === 'tab' && activeTab === 'map';
  const navigationFullscreen = mapVisible && navigationActive;
  const [mapVisited, setMapVisited] = useState(mapVisible);
  const mainRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!mapVisible) return;
    setMapVisited(true);
    if (mainRef.current) mainRef.current.scrollTop = 0;
    const frame = requestAnimationFrame(() => window.dispatchEvent(new Event('resize')));
    return () => cancelAnimationFrame(frame);
  }, [mapVisible]);

  const navigateTo = useCallback((mode: ViewMode) => {
    void triggerHaptic('light');
    setViewHistory((prev) => [...prev, viewMode]);
    setViewMode(mode);
  }, [viewMode]);

  const handleBack = useCallback(() => {
    void triggerHaptic('light');
    if (viewHistory.length > 0) {
      const prev = viewHistory[viewHistory.length - 1];
      setViewHistory((prevList) => prevList.slice(0, -1));
      setViewMode(prev);
    } else {
      setViewMode('tab');
    }
  }, [viewHistory]);

  // Handle hardware Android back button
  useEffect(() => {
    const unsub = onHardwareBackButton(() => {
      handleAppBack({ inSubview: viewMode !== 'tab', inOtherTab: activeTab !== 'map' }, {
        previousView: handleBack,
        mapTab: () => setActiveTab('map'),
        minimize: () => { void minimizeAndroidApp(); },
      });
    });
    return () => unsub();
  }, [viewMode, activeTab, handleBack]);

  const handleAnnouncementNavigation = (path: string) => {
    if (path === '/registro') return navigateTo('register');
    if (path === '/ingresar') return navigateTo('login');
    if (path === '/contactanos') { window.open('https://civigo.online/contactanos', '_blank', 'noopener,noreferrer'); return; }
    if (['/ranking', '/recompensas', '/comunidad'].includes(path)) return navigateTo('community');
    setViewHistory([]); setViewMode('tab');
    setActiveTab(path === '/reportar' ? 'report' : ['/perfil', '/premium'].includes(path) ? 'profile' : path === '/alertas' ? 'alerts' : path === '/mis-reportes' ? 'reports' : 'map');
    const id = path.match(/^\/incidentes\/(\d+)$/)?.[1];
    if (id) setNotificationIncidentId(Number(id));
  };

  const renderContent = () => {
    switch (viewMode) {
      case 'login':
        return (
          <LoginPage
            onSuccess={() => { setViewHistory([]); setViewMode('tab'); }}
            onGoRegister={() => navigateTo('register')}
            onGoForgot={() => navigateTo('forgot')}
            onBack={handleBack}
          />
        );
      case 'register':
        return (
          <RegisterPage
            onSuccess={() => navigateTo('verify')}
            onGoLogin={() => navigateTo('login')}
            onBack={handleBack}
          />
        );
      case 'forgot':
        return (
          <ForgotPasswordPage
            onBack={handleBack}
            onGoLogin={() => navigateTo('login')}
          />
        );
      case 'verify':
        return (
          <VerifyEmailPage
            onBack={handleBack}
            onGoMap={() => {
              setViewHistory([]);
              setViewMode('tab');
              setActiveTab('map');
            }}
          />
        );
      case 'agent':
        return <AgentPage onBack={handleBack} />;
      case 'community':
        return <CommunityPage />;
      case 'tab':
      default:
        switch (activeTab) {
          case 'map':
            return null; // The map retains its navigation state in a stable sibling below.
          case 'reports':
            return (
              <MyReportsPage
                onGoLogin={() => navigateTo('login')}
                onGoRegister={() => navigateTo('register')}
                onGoReport={() => setActiveTab('report')}
              />
            );
          case 'report':
            return (
              <ReportPage
                onGoLogin={() => navigateTo('login')}
                onGoRegister={() => navigateTo('register')}
                onGoVerify={() => navigateTo('verify')}
                onGoMyReports={() => setActiveTab('reports')}
                onGoMap={() => setActiveTab('map')}
              />
            );
          case 'alerts':
            return (
              <AlertsPage
                onGoLogin={() => navigateTo('login')}
                onGoRegister={() => navigateTo('register')}
                onSelectIncidentId={setNotificationIncidentId}
              />
            );
          case 'profile':
            return (
              <ProfilePage
                onGoLogin={() => navigateTo('login')}
                onGoRegister={() => navigateTo('register')}
                onGoVerify={() => navigateTo('verify')}
                onGoCommunity={() => navigateTo('community')}
              />
            );
        }
    }
  };

  const getPageTitle = () => {
    switch (viewMode) {
      case 'login':
        return 'Iniciar sesión';
      case 'register':
        return 'Crear cuenta';
      case 'forgot':
        return 'Recuperar acceso';
      case 'verify':
        return 'Verificar Gmail';
      case 'agent':
        return 'Consola Agente';
      case 'community':
        return 'Comunidad';
      case 'tab':
      default:
        switch (activeTab) {
          case 'map':
            return undefined; // Shows default brand logo
          case 'reports':
            return 'Mis Reportes';
          case 'report':
            return 'Reportar';
          case 'alerts':
            return 'Alertas';
          case 'profile':
            return 'Mi Perfil';
        }
    }
  };

  return (
    <div className={`app-container ${navigationFullscreen ? 'app-navigation-fullscreen' : ''}`}>
      {!navigationFullscreen && <MobileHeader
        title={getPageTitle()}
        showBack={viewMode !== 'tab'}
        onBack={handleBack}
        onOpenAgent={() => navigateTo('agent')}
      />}

      {!navigationFullscreen && <MobileAnnouncements onNavigate={handleAnnouncementNavigation}/>}
      <main className="app-main" ref={mainRef}>
        {(mapVisited || mapVisible) && <div className="retained-map-view" hidden={!mapVisible} style={{ height: '100%' }}><MapPage visible={mapVisible} onGoReport={() => setActiveTab('report')} onNavigationChange={setNavigationActive} /></div>}
        <div className="other-app-view" hidden={mapVisible}>{viewMode==='tab'&&activeTab==='report'&&<MobileAnnouncements placement="REPORTAR" onNavigate={handleAnnouncementNavigation}/>} {renderContent()}</div>
      </main>

      {notificationIncidentId !== null && <IncidentFromAlert key={notificationIncidentId} id={notificationIncidentId} onClose={() => setNotificationIncidentId(null)} />}

      {viewMode === 'tab' && !navigationFullscreen && (
        <BottomNavigation
          activeTab={activeTab}
          onChangeTab={(tab) => {
            setActiveTab(tab);
          }}
        />
      )}
    </div>
  );
};

export const App: React.FC = () => {
  return (
    <ThemeProvider>
      <AuthProvider>
        <AppContent />
      </AuthProvider>
    </ThemeProvider>
  );
};

export default App;
