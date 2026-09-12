"use client";

import { Languages } from "lucide-react";
import {
  InterfaceLanguage,
  useInterfaceLanguage,
} from "../contexts/InterfaceLanguageContext";

interface LanguageModeSelectorProps {
  compact?: boolean;
  className?: string;
}

const OPTIONS: Array<{ value: InterfaceLanguage; label: string; title: string }> = [
  { value: "zh", label: "中文", title: "使用中文界面" },
  { value: "en", label: "English", title: "Use English interface" },
];

export default function LanguageModeSelector({
  compact = false,
  className = "",
}: LanguageModeSelectorProps) {
  const { language, setLanguage, text } = useInterfaceLanguage();

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <span className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-[var(--text-muted)]">
        <Languages className="h-3.5 w-3.5" />
        {!compact && text("界面语言", "UI language")}
      </span>
      <div
        className="flex rounded-lg border border-[var(--border-primary)] bg-[var(--bg-sunken)] p-0.5"
        role="group"
        aria-label={text("界面语言", "Interface language")}
      >
        {OPTIONS.map((option) => (
          <button
            key={option.value}
            type="button"
            title={option.title}
            aria-pressed={language === option.value}
            onClick={() => setLanguage(option.value)}
            className={`rounded-md px-2 py-1 text-[10px] font-semibold transition-colors ${
              language === option.value
                ? "bg-[var(--accent-bg)] text-[var(--accent-text)] shadow-sm"
                : "text-[var(--text-muted)] hover:text-[var(--text-primary)]"
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}
