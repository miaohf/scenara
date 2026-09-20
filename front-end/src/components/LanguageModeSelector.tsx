"use client";

import { Languages } from "lucide-react";
import { useInterfaceLanguage } from "../contexts/InterfaceLanguageContext";

interface LanguageModeSelectorProps {
  compact?: boolean;
  className?: string;
}

export default function LanguageModeSelector({
  compact = false,
  className = "",
}: LanguageModeSelectorProps) {
  const { language, setLanguage, t } = useInterfaceLanguage();
  const title = language === "zh" ? t('common.switchToEnglish') : t('common.switchToChinese');

  if (compact) {
    return (
      <button
        type="button"
        onClick={() => setLanguage(language === "zh" ? "en" : "zh")}
        className={`flex h-4 w-4 shrink-0 items-center justify-center rounded text-[var(--text-muted)] transition-colors hover:text-[var(--text-primary)] ${className}`}
        title={title}
        aria-label={title}
      >
        <Languages className="h-4 w-4" aria-hidden="true" />
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setLanguage(language === "zh" ? "en" : "zh")}
      className={`flex items-center justify-between gap-3 rounded-lg px-2 py-2 text-[var(--text-muted)] hover:bg-[var(--nav-hover-bg)] hover:text-[var(--text-primary)] cursor-pointer transition-colors ${className}`}
      title={title}
      aria-label={title}
    >
      <span className="font-mono text-[10px] uppercase tracking-widest">
        {t('common.language')}
      </span>
      <Languages className="h-4 w-4" aria-hidden="true" />
    </button>
  );
}
