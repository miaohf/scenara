import type { ReactNode } from "react";
import { Clapperboard } from "lucide-react";
import LanguageModeSelector from "./LanguageModeSelector";
import { useInterfaceLanguage } from "../contexts/InterfaceLanguageContext";

export function AuthShell({ children }: { children: ReactNode }) {
  const { text } = useInterfaceLanguage();

  return (
    <div className="relative min-h-screen overflow-hidden bg-[var(--bg-base)] text-[var(--text-primary)]">
      <LanguageModeSelector className="absolute right-5 top-5 z-20 rounded-xl bg-[var(--bg-primary)]/80 p-2 backdrop-blur-sm" />
      <div
        aria-hidden
        className="pointer-events-none absolute -top-40 right-[-80px] h-[520px] w-[520px] rounded-full bg-[var(--accent)]/12 blur-3xl"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute bottom-[-160px] left-[-80px] h-[420px] w-[420px] rounded-full bg-[var(--accent)]/8 blur-3xl"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.035]"
        style={{
          backgroundImage:
            "linear-gradient(var(--text-primary) 1px, transparent 1px), linear-gradient(90deg, var(--text-primary) 1px, transparent 1px)",
          backgroundSize: "72px 72px",
        }}
      />

      <div className="relative mx-auto grid min-h-screen w-full max-w-6xl lg:grid-cols-[1.05fr_0.95fr]">
        <section className="hidden flex-col justify-between px-12 py-14 lg:flex">
          <div className="flex items-center gap-3">
            <span className="flex size-10 items-center justify-center rounded-xl bg-[var(--accent-bg)] text-[var(--accent-text)] ring-1 ring-[var(--accent-border)]">
              <Clapperboard className="size-5" />
            </span>
            <span className="text-sm font-semibold tracking-[0.28em] text-[var(--text-secondary)]">
              SCENARA
            </span>
          </div>

          <div className="max-w-md space-y-5">
            <p className="text-[11px] font-medium uppercase tracking-[0.32em] text-[var(--accent-text)]">
              {text("AI 漫剧工作台", "AI STORY PRODUCTION")}
            </p>
            <h1 className="text-5xl leading-[1.12] font-semibold tracking-tight text-[var(--text-primary)]">
              {text("把剧本", "Turn scripts")}
              <br />
              {text("变成画面", "into scenes")}
            </h1>
            <p className="max-w-sm text-sm leading-7 text-[var(--text-tertiary)]">
              {text(
                "从故事拆解、角色定妆到分镜与成片，在同一条创作流里完成。",
                "Plan stories, develop characters, produce shots and deliver the final cut in one workflow.",
              )}
            </p>
          </div>

          <p className="text-xs tracking-wide text-[var(--text-muted)]">
            {text("剧本 · 资产 · 导演 · 导出", "Script · Assets · Director · Export")}
          </p>
        </section>

        <section className="flex items-center justify-center p-6 sm:p-10">
          {children}
        </section>
      </div>
    </div>
  );
}
