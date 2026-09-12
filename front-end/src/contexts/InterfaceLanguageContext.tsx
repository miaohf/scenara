"use client";

import React, { createContext, useCallback, useContext, useEffect, useSyncExternalStore } from "react";

const STORAGE_KEY = "scenara_interface_language";

export type InterfaceLanguage = "zh" | "en";

interface InterfaceLanguageContextValue {
  language: InterfaceLanguage;
  setLanguage: (language: InterfaceLanguage) => void;
  text: (chinese: string, english: string) => string;
}

const InterfaceLanguageContext = createContext<InterfaceLanguageContextValue | null>(null);

const isInterfaceLanguage = (value: string | null): value is InterfaceLanguage =>
  value === "zh" || value === "en";

const languageListeners = new Set<() => void>();

const getLanguageSnapshot = (): InterfaceLanguage => {
  const stored = localStorage.getItem(STORAGE_KEY);
  return isInterfaceLanguage(stored) ? stored : "zh";
};

const subscribeToLanguage = (listener: () => void) => {
  const handleStorage = (event: StorageEvent) => {
    if (event.key === STORAGE_KEY) listener();
  };
  languageListeners.add(listener);
  window.addEventListener("storage", handleStorage);
  return () => {
    languageListeners.delete(listener);
    window.removeEventListener("storage", handleStorage);
  };
};

export function InterfaceLanguageProvider({ children }: { children: React.ReactNode }) {
  const language = useSyncExternalStore(
    subscribeToLanguage,
    getLanguageSnapshot,
    (): InterfaceLanguage => "zh",
  );

  useEffect(() => {
    document.documentElement.lang = language === "en" ? "en" : "zh-CN";
    document.documentElement.dataset.interfaceLanguage = language;
  }, [language]);

  const setLanguage = useCallback((nextLanguage: InterfaceLanguage) => {
    localStorage.setItem(STORAGE_KEY, nextLanguage);
    languageListeners.forEach((listener) => listener());
  }, []);

  const text = useCallback(
    (chinese: string, english: string) => {
      return language === "zh" ? chinese : english;
    },
    [language],
  );

  return (
    <InterfaceLanguageContext.Provider value={{ language, setLanguage, text }}>
      {children}
    </InterfaceLanguageContext.Provider>
  );
}

export function useInterfaceLanguage(): InterfaceLanguageContextValue {
  const context = useContext(InterfaceLanguageContext);
  if (!context) {
    throw new Error("useInterfaceLanguage must be used within InterfaceLanguageProvider");
  }
  return context;
}
