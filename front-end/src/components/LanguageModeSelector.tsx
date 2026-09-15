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

  return (
    <div className={`flex w-full items-center justify-between gap-2 rounded-lg px-2 py-2 ${className}`}>
      {!compact && (
        <span className="text-[10px] uppercase tracking-wider text-[var(--text-muted)]">
          {t('common.language')}
        </span>
      )}
      <button
        type="button"
        onClick={() => setLanguage(language === "zh" ? "en" : "zh")}
        className="flex h-4 w-4 shrink-0 items-center justify-center rounded text-[var(--text-muted)] transition-colors hover:text-[var(--text-primary)]"
        title={language === "zh" ? t('common.switchToEnglish') : t('common.switchToChinese')}
        aria-label={language === "zh" ? t('common.switchToEnglish') : t('common.switchToChinese')}
      >
        <Languages className="h-4 w-4" aria-hidden="true" />
      </button>
    </div>
  );
}
