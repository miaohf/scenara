"use client";

"use client";

import { useEffect, useRef, type FormEvent, type ReactNode } from "react";
import { X } from "lucide-react";

interface AppDialogProps {
  open: boolean;
  title: string;
  description?: string;
  confirmText?: string;
  cancelText?: string;
  danger?: boolean;
  submitting?: boolean;
  confirmDisabled?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  children?: ReactNode;
}

export function AppDialog({
  open,
  title,
  description,
  confirmText = "确认",
  cancelText = "取消",
  danger = false,
  submitting = false,
  confirmDisabled = false,
  onConfirm,
  onCancel,
  children,
}: AppDialogProps) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !submitting) onCancel();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, submitting, onCancel]);

  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => {
      const focusable = panelRef.current?.querySelector<HTMLElement>(
        "input, textarea, button:not([disabled])",
      );
      focusable?.focus();
      if (focusable instanceof HTMLInputElement) focusable.select();
    }, 20);
    return () => window.clearTimeout(timer);
  }, [open]);

  if (!open) return null;

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!submitting && !confirmDisabled) onConfirm();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--overlay-heavy)] p-4 backdrop-blur-[2px]"
      onClick={(event) => {
        if (event.target === event.currentTarget && !submitting) onCancel();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="app-dialog-title"
        className="w-full max-w-md overflow-hidden rounded-2xl border border-[var(--border-primary)] bg-[var(--bg-primary)] shadow-[0_24px_80px_var(--overlay-medium)]"
      >
        <form onSubmit={handleSubmit}>
          <div className="flex items-start justify-between gap-4 px-6 pt-5 pb-2">
            <div>
              <h2
                id="app-dialog-title"
                className="text-base font-semibold text-[var(--text-primary)]"
              >
                {title}
              </h2>
              {description ? (
                <p className="mt-1 text-sm leading-6 text-[var(--text-tertiary)]">{description}</p>
              ) : null}
            </div>
            <button
              type="button"
              onClick={onCancel}
              disabled={submitting}
              className="rounded-lg p-1 text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] disabled:opacity-40"
              aria-label="关闭"
            >
              <X className="size-4" />
            </button>
          </div>
          {children ? <div className="px-6 py-3">{children}</div> : null}
          <div className="flex items-center justify-end gap-2 px-6 py-4">
            <button
              type="button"
              onClick={onCancel}
              disabled={submitting}
              className="rounded-lg border border-[var(--border-secondary)] bg-[var(--bg-surface)] px-3.5 py-2 text-xs font-semibold tracking-wide text-[var(--text-tertiary)] transition-colors hover:border-[var(--border-primary)] hover:text-[var(--text-primary)] disabled:opacity-40"
            >
              {cancelText}
            </button>
            <button
              type="submit"
              disabled={submitting || confirmDisabled}
              className={
                danger
                  ? "rounded-lg bg-[var(--error)] px-3.5 py-2 text-xs font-semibold tracking-wide text-[var(--bg-base)] transition-opacity hover:opacity-90 disabled:opacity-40"
                  : "rounded-lg bg-[var(--btn-primary-bg)] px-3.5 py-2 text-xs font-semibold tracking-wide text-[var(--btn-primary-text)] shadow-[0_8px_24px_var(--btn-primary-shadow)] transition-colors hover:bg-[var(--btn-primary-hover)] disabled:opacity-40"
              }
            >
              {submitting ? "处理中..." : confirmText}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
