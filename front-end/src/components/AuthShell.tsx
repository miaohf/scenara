import type { ReactNode } from "react";
import { Clapperboard } from "lucide-react";

export function AuthShell({ children }: { children: ReactNode }) {
  return (
    <div className="relative min-h-screen overflow-hidden bg-[var(--bg-base)] text-[var(--text-primary)]">
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
              AI 漫剧工作台
            </p>
            <h1 className="text-5xl leading-[1.12] font-semibold tracking-tight text-[var(--text-primary)]">
              把剧本
              <br />
              变成画面
            </h1>
            <p className="max-w-sm text-sm leading-7 text-[var(--text-tertiary)]">
              从故事拆解、角色定妆到分镜与成片，在同一条创作流里完成。
            </p>
          </div>

          <p className="text-xs tracking-wide text-[var(--text-muted)]">
            Script · Assets · Director · Export
          </p>
        </section>

        <section className="flex items-center justify-center p-6 sm:p-10">
          {children}
        </section>
      </div>
    </div>
  );
}
