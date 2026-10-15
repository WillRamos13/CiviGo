import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { StorageService } from '../services/native';
import { ThemeController, preferredTheme, type Theme } from '../services/theme';

interface ThemeContextType {
  theme: Theme;
  toggleTheme: () => void;
  isDark: boolean;
}

const ThemeContext = createContext<ThemeContextType>({
  theme: 'light',
  toggleTheme: () => {},
  isDark: false,
});

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [theme, setTheme] = useState<Theme>(preferredTheme);
  const controller = useRef<ThemeController | null>(null);
  if (!controller.current) controller.current = new ThemeController(theme, StorageService, setTheme);

  useEffect(() => {
    return controller.current!.initialize();
  }, []);

  useEffect(() => { document.documentElement.setAttribute('data-theme', theme); }, [theme]);

  const toggleTheme = useCallback(() => {
    controller.current!.toggle();
  }, []);

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme, isDark: theme === 'dark' }}>
      {children}
    </ThemeContext.Provider>
  );
};

export const useTheme = () => useContext(ThemeContext);
