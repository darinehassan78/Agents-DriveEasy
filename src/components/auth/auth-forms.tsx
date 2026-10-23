"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState, useTransition, type FormEvent } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { Spinner } from "@/components/ui/spinner";
import { authClient } from "@/lib/auth-client";
import { safeNext } from "@/lib/safe-redirect";

function friendly(message: string | undefined, fallback: string) {
  if (!message) return fallback;
  if (/invalid (email or password|credentials)/i.test(message)) return "That email and password don't match an account.";
  if (/already exists|already registered|user_already_exists/i.test(message)) {
    return "An account with this email already exists. Try logging in.";
  }
  if (/password.*(short|least)/i.test(message)) return "Password must be at least 8 characters.";
  return message;
}

export function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = safeNext(params.get("next"), "/");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const email = String(form.get("email") ?? "").trim();
    const password = String(form.get("password") ?? "");
    if (!email || !password) return setError("Enter your email and password.");
    setError(null);
    start(async () => {
      const { error } = await authClient.signIn.email({ email, password });
      if (error) return setError(friendly(error.message, "We couldn't log you in. Please try again."));
      router.replace(next);
      router.refresh();
    });
  }

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4" aria-label="Log in">
      {error && <Alert tone="danger">{error}</Alert>}
      <Field label="Email" htmlFor="email">
        <Input id="email" name="email" type="email" autoComplete="email" required />
      </Field>
      <Field label="Password" htmlFor="password">
        <Input id="password" name="password" type="password" autoComplete="current-password" required />
      </Field>
      <Button type="submit" size="lg" className="w-full" disabled={pending} data-testid="login-submit">
        {pending && <Spinner className="size-4" />}
        {pending ? "Logging in…" : "Log in"}
      </Button>
      <p className="text-center text-sm text-muted">
        New to DriveEasy?{" "}
        <Link className="font-medium text-brand hover:underline" href={`/register${next !== "/" ? `?next=${encodeURIComponent(next)}` : ""}`}>
          Create an account
        </Link>
      </p>
    </form>
  );
}

export function RegisterForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = safeNext(params.get("next"), "/profile?welcome=1");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const name = String(form.get("name") ?? "").trim();
    const email = String(form.get("email") ?? "").trim();
    const password = String(form.get("password") ?? "");
    const confirm = String(form.get("confirm") ?? "");
    const errs: Record<string, string> = {};
    if (name.length < 2) errs.name = "Enter your full name.";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errs.email = "Enter a valid email address.";
    if (password.length < 8) errs.password = "Use at least 8 characters.";
    if (confirm !== password) errs.confirm = "Passwords don't match.";
    setErrors(errs);
    setFormError(null);
    if (Object.keys(errs).length) return;
    start(async () => {
      const { error } = await authClient.signUp.email({ name, email, password });
      if (error) return setFormError(friendly(error.message, "We couldn't create your account. Please try again."));
      router.replace(next);
      router.refresh();
    });
  }

  const aria = (k: string) => ({
    "aria-invalid": errors[k] ? (true as const) : undefined,
    "aria-describedby": errors[k] ? `${k}-error` : undefined,
  });

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4" aria-label="Create account">
      {formError && <Alert tone="danger">{formError}</Alert>}
      <Field label="Full name" htmlFor="name" errors={errors.name}>
        <Input id="name" name="name" autoComplete="name" required {...aria("name")} />
      </Field>
      <Field label="Email" htmlFor="email" errors={errors.email}>
        <Input id="email" name="email" type="email" autoComplete="email" required {...aria("email")} />
      </Field>
      <Field label="Password" htmlFor="password" errors={errors.password} hint={errors.password ? undefined : "At least 8 characters."}>
        <Input id="password" name="password" type="password" autoComplete="new-password" required {...aria("password")} />
      </Field>
      <Field label="Confirm password" htmlFor="confirm" errors={errors.confirm}>
        <Input id="confirm" name="confirm" type="password" autoComplete="new-password" required {...aria("confirm")} />
      </Field>
      <Button type="submit" size="lg" className="w-full" disabled={pending} data-testid="register-submit">
        {pending && <Spinner className="size-4" />}
        {pending ? "Creating account…" : "Create account"}
      </Button>
      <p className="text-center text-sm text-muted">
        Already have an account?{" "}
        <Link className="font-medium text-brand hover:underline" href={`/login${params.get("next") ? `?next=${encodeURIComponent(next)}` : ""}`}>
          Log in
        </Link>
      </p>
    </form>
  );
}
