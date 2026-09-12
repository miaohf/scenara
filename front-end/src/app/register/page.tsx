"use client";

import { useState } from "react";
import Link from "next/link";
import { useAuth } from "@/providers/auth-provider";
import { AuthShell } from "@/components/AuthShell";
import { useInterfaceLanguage } from "@/contexts/InterfaceLanguageContext";

export default function RegisterPage() {
  const { register } = useAuth();
  const { text } = useInterfaceLanguage();
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const email = String(form.get("email") || "").trim();
    const username = String(form.get("username") || "").trim();
    const password = String(form.get("password") || "");
    setError("");
    setSubmitting(true);
    try {
      await register(email, username, password);
    } catch (err) {
      setError(err instanceof Error ? err.message : text("注册失败", "Registration failed"));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthShell>
      <div className="w-full max-w-[420px] rounded-2xl border border-[var(--border-primary)] bg-[var(--bg-primary)]/90 p-8 shadow-[0_24px_80px_var(--overlay-light)] backdrop-blur-sm">
        <div className="mb-8 space-y-2">
          <p className="text-[11px] font-medium uppercase tracking-[0.28em] text-[var(--accent-text)] lg:hidden">
            SCENARA
          </p>
          <h2 className="text-2xl font-semibold tracking-tight text-[var(--text-primary)]">{text("创建账号", "Create account")}</h2>
          <p className="text-sm text-[var(--text-tertiary)]">{text("加入后即可开始你的第一个项目", "Create your first production project")}</p>
        </div>

        <form method="post" action="#" onSubmit={handleSubmit} className="space-y-5">
          {error ? (
            <p className="rounded-lg border border-[var(--error-border)] bg-[var(--error-bg)] px-3 py-2 text-sm text-[var(--error-text)]">
              {error}
            </p>
          ) : null}

          <label className="block space-y-2">
            <span className="text-xs font-medium text-[var(--text-secondary)]">{text("邮箱", "Email")}</span>
            <input
              name="email"
              type="email"
              autoComplete="email"
              required
              className="h-11 w-full rounded-xl border border-[var(--border-primary)] bg-[var(--bg-sunken)] px-3.5 text-sm text-[var(--text-primary)] outline-none transition-colors placeholder:text-[var(--text-muted)] focus:border-[var(--accent-border)] focus:ring-2 focus:ring-[var(--accent-shadow)]"
            />
          </label>

          <label className="block space-y-2">
            <span className="text-xs font-medium text-[var(--text-secondary)]">{text("用户名", "Username")}</span>
            <input
              name="username"
              autoComplete="username"
              required
              className="h-11 w-full rounded-xl border border-[var(--border-primary)] bg-[var(--bg-sunken)] px-3.5 text-sm text-[var(--text-primary)] outline-none transition-colors placeholder:text-[var(--text-muted)] focus:border-[var(--accent-border)] focus:ring-2 focus:ring-[var(--accent-shadow)]"
            />
          </label>

          <label className="block space-y-2">
            <span className="text-xs font-medium text-[var(--text-secondary)]">{text("密码", "Password")}</span>
            <input
              name="password"
              type="password"
              autoComplete="new-password"
              minLength={6}
              required
              className="h-11 w-full rounded-xl border border-[var(--border-primary)] bg-[var(--bg-sunken)] px-3.5 text-sm text-[var(--text-primary)] outline-none transition-colors placeholder:text-[var(--text-muted)] focus:border-[var(--accent-border)] focus:ring-2 focus:ring-[var(--accent-shadow)]"
            />
          </label>

          <button
            type="submit"
            disabled={submitting}
            className="mt-2 h-11 w-full rounded-xl bg-[var(--btn-primary-bg)] text-sm font-semibold text-[var(--btn-primary-text)] shadow-[0_10px_28px_var(--btn-primary-shadow)] transition-colors hover:bg-[var(--btn-primary-hover)] disabled:opacity-50"
          >
            {submitting ? text("注册中…", "Creating…") : text("注册", "Create account")}
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-[var(--text-muted)]">
          {text("已有账号？", "Already have an account?")}{" "}
          <Link
            href="/login"
            className="font-medium text-[var(--accent-text)] transition-colors hover:text-[var(--accent-text-hover)]"
          >
            {text("登录", "Sign in")}
          </Link>
        </p>
      </div>
    </AuthShell>
  );
}
