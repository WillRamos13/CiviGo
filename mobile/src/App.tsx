import React, { useState, useEffect, useCallback } from 'react';
import { AuthProvider } from './hooks/useAuth';
import { ThemeProvider } from './hooks/useTheme';
import { MobileHeader } from './components/layout/MobileHeader';
import { BottomNavigation, type TabId } from './components/layout/BottomNavigation';
import { onHardwareBackButton, triggerHaptic } from './services/native';

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
  const [viewMode, setViewMode] = useState<ViewMode>('tab');
  const [viewHistory, setViewHistory] = useState<ViewMode[]>([]);

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
      if (viewMode !== 'tab') {
        handleBack();
      } else if (activeTab !== 'map') {
        setActiveTab('map');
      }
    });
    return () => unsub();
  }, [viewMode, activeTab, handleBack]);

  const renderContent = () => {
    switch (viewMode) {
      case 'login':
        return (
          <LoginPage
            onSuccess={() => setViewMode('tab')}
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
            return <MapPage onGoReport={() => setActiveTab('report')} />;
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
    <div className="app-container">
      <MobileHeader
        title={getPageTitle()}
        showBack={viewMode !== 'tab'}
        onBack={handleBack}
        onOpenAgent={() => navigateTo('agent')}
      />

      <main className="app-main">{renderContent()}</main>

      {viewMode === 'tab' && (
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
