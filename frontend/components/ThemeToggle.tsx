"use client";

import { Moon, Sun } from 'lucide-react';
import { useTheme } from './ThemeProvider';

export default function ThemeToggle() {
    const { resolvedTheme, setTheme } = useTheme();
    const dark = resolvedTheme === 'dark';
    const label = dark ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro';
    return (
        <button
            type="button"
            className="icon-btn"
            title={label}
            aria-label={label}
            aria-pressed={dark}
            onClick={() => setTheme(dark ? 'light' : 'dark')}
        >
            {dark ? <Sun size={19} aria-hidden="true" /> : <Moon size={19} aria-hidden="true" />}
        </button>
    );
}
