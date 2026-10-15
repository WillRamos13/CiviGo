import React, { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';
import { INITIAL_SESSION, SessionController, type SessionState } from '../services/auth';
import { onNetworkChange } from '../services/native';
import type { Usuario } from '../types';

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

  const controller = useMemo(
    () =>
      new SessionController(
        (nextState) => setState(nextState),
        () => navigator.onLine
      ),
    []
  );

  const refresh = useCallback(() => controller.refresh(), [controller]);
  const logout = useCallback(() => controller.logout(), [controller]);

  useEffect(() => {
    void refresh();

    const unsubNetwork = onNetworkChange((status) => {
      if (status.connected) {
        void refresh();
      } else {
        void controller.refresh();
      }
    });

    const handleFocus = () => {
      if (document.visibilityState === 'visible' && navigator.onLine) {
        void refresh();
      }
    };

    window.addEventListener('focus', handleFocus);
    document.addEventListener('visibilitychange', handleFocus);

    return () => {
      unsubNetwork();
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
