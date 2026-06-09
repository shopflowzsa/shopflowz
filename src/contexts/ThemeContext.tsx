import React, { createContext, useContext, useEffect, useState } from "react";

type Theme = "light" | "dark" | "mixed";

interface ThemeContextValue {
  theme: Theme;
  toggle: () => void;
}

const ThemeContext = createContext<ThemeContextValue>({ theme: "light", toggle: () => {} });

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = useState<Theme>(() => {
    const stored = localStorage.getItem("sr-theme");
    // New users (no saved preference) default to light; existing users keep their choice.
    return (stored === "light" || stored === "dark" || stored === "mixed") ? stored : "light";
  });

  useEffect(() => {
    const root = document.documentElement;
    root.classList.remove("dark", "mixed");
    if (theme === "dark") root.classList.add("dark");
    if (theme === "mixed") root.classList.add("mixed");
    localStorage.setItem("sr-theme", theme);
  }, [theme]);

  const toggle = () =>
    setTheme((t) => (t === "dark" ? "light" : t === "light" ? "mixed" : "dark"));

  return (
    <ThemeContext.Provider value={{ theme, toggle }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
