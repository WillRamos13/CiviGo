import React, { createContext, useContext, useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { INITIAL_SESSION, SessionController, updateAuthNetworkStatus, type SessionState } from '../services/auth';
import { onNetworkChange, getNetworkStatus } from '../services/native';
import { onUnauthorized } from '../services/api';

interface AuthContextType extends SessionState {
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  ...INITIAL_SESSION,
  refresh: async () => {},
  logout: async () => {},
});

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [state, setState] = useState<SessionState>(INITIAL_SESSION);
  const connected = useRef(navigator.onLine);

  const controller = useMemo(
    () =>
      new SessionController(
        (nextState) => setState(nextState),
        () => connected.current
      ),
    []
  );

  const refresh = useCallback(() => controller.refresh(), [controller]);
  const logout = useCallback(() => controller.logout(), [controller]);

  useEffect(() => {
    let active = true;
    void refresh();
    void getNetworkStatus().then(status => {
      if (!active) return;
      updateAuthNetworkStatus(status.connected);
      if (connected.current !== status.connected) {
        connected.current = status.connected;
        void refresh();
      }
    });

    const unsubNetwork = onNetworkChange((status) => {
      if (!active) return;
      updateAuthNetworkStatus(status.connected);
      connected.current = status.connected;
      void refresh();
    });
    const unsubUnauthorized = onUnauthorized(() => controller.expire());

    const handleFocus = () => {
      if (document.visibilityState === 'visible') {
        void refresh();
      }
    };

    window.addEventListener('focus', handleFocus);
    document.addEventListener('visibilitychange', handleFocus);
    const retry = window.setInterval(() => {
      if (connected.current && document.visibilityState === 'visible') void controller.recover().catch(() => {});
    }, 15000);

    return () => {
      active = false;
      unsubNetwork();
      unsubUnauthorized();
      window.clearInterval(retry);
      window.removeEventListener('focus', handleFocus);
      document.removeEventListener('visibilitychange', handleFocus);
      controller.invalidate();
    };
  }, [controller, refresh]);

  return (
    <AuthContext.Provider value={{ ...state, refresh, logout }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
