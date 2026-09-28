"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState, type FormEvent } from "react";
import { ArrowRight, LockKeyhole, MessageSquareText, UserRound } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

type AuthFormProps = { mode: "login" | "register" };

function authEmail(userId: string) {
  return `${userId}@users.mrh-postbox.invalid`;
}

export function AuthForm({ mode }: AuthFormProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [fullName, setFullName] = useState("");
  const [userId, setUserId] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const registering = mode === "register";

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setSuccess("");

    if (!/^\d{11}$/.test(userId)) {
      setError("User ID must contain exactly 11 digits.");
      return;
    }
    if (registering && !fullName.trim()) {
      setError("Enter your full name.");
      return;
    }
    if (password.length < 8) {
      setError("Use a password with at least 8 characters.");
      return;
    }
    if (registering && password !== confirmPassword) {
      setError("The passwords do not match.");
      return;
    }
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
      setError("Supabase is not configured yet. Add the project URL and anon key to .env.local.");
      return;
    }

    setPending(true);
    try {
      const supabase = createClient();
      if (registering) {
        const { data, error: signUpError } = await supabase.auth.signUp({
          email: authEmail(userId),
          password,
          options: { data: { user_id: userId, full_name: fullName.trim() } },
        });
        if (signUpError) {
          const message = signUpError.message.toLowerCase();
          const code = signUpError.code?.toLowerCase();
          if (message.includes("duplicate") || message.includes("already") || code === "23505" || code === "email_exists") {
            setError("That User ID is already registered. Sign in instead or use another ID.");
          } else if (code === "signup_disabled") {
            setError("New accounts are disabled in this Supabase project. Enable signups under Authentication settings.");
          } else if (code === "weak_password" || message.includes("password")) {
            setError("Supabase rejected that password. Choose a stronger password with at least 8 characters.");
          } else if (code === "email_address_invalid" || message.includes("invalid email")) {
            setError("Supabase Auth rejected the internal account identifier. Check that Email sign-in is enabled in Supabase.");
          } else if (["23502", "23503", "23514"].includes(code ?? "") || message.includes("database error saving new user")) {
            setError("Supabase could not create the profile. Run the initial database migration in the SQL Editor, then try again.");
          } else if (signUpError.status === 429) {
            setError("Too many signup attempts. Wait a little and try again.");
          } else {
            setError("Supabase could not create the account. Check the database migration and Email sign-in settings, then try again.");
          }
        } else if (!data.session) {
          setSuccess("Your account is ready. Sign in to continue.");
        } else {
          router.replace("/chat");
          router.refresh();
        }
      } else {
        const { error: signInError } = await supabase.auth.signInWithPassword({
          email: authEmail(userId),
          password,
        });
        if (signInError) {
          setError("That User ID and password combination was not recognized.");
        } else {
          const nextPath = searchParams.get("next");
          router.replace(nextPath?.startsWith("/") && !nextPath.startsWith("//") ? nextPath : "/chat");
          router.refresh();
        }
      }
    } catch {
      setError("A network error occurred. Please try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="auth-grid min-h-screen bg-[var(--paper)] px-5 py-8 sm:px-10 sm:py-12">
      <div className="mx-auto flex min-h-[calc(100vh-4rem)] w-full max-w-6xl flex-col justify-between gap-12 sm:min-h-[calc(100vh-6rem)]">
        <Link href="/" className="brand-lockup w-fit" aria-label="MRH-POSTBOX home">
          <span className="brand-mark"><MessageSquareText size={19} strokeWidth={2.1} /></span>
          <span>MRH-<b>POSTBOX</b></span>
        </Link>

        <div className="grid flex-1 items-center gap-14 py-4 lg:grid-cols-[1fr_400px] lg:gap-24">
          <section className="max-w-xl">
            <p className="eyebrow">A quieter place to talk</p>
            <h1 className="mt-5 font-display text-5xl leading-[1.04] text-[var(--ink)] sm:text-6xl">
              Keep the conversation <i className="text-[var(--coral)]">close.</i>
            </h1>
            <p className="mt-6 max-w-md text-base leading-7 text-[var(--muted)]">
              Private messages, familiar faces, and the space to catch up properly.
            </p>
            <div className="mt-10 flex items-center gap-3 text-sm text-[var(--muted)]">
              <span className="online-dot" /> One-to-one, always private
            </div>
          </section>

          <section className="auth-panel">
            <div className="mb-7">
              <p className="eyebrow">{registering ? "A new beginning" : "Welcome back"}</p>
              <h2 className="mt-2 font-display text-3xl text-[var(--ink)]">
                {registering ? "Create your account" : "Sign in to your space"}
              </h2>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              {registering && (
                <label className="field-label">
                  Full name
                  <span className="field-wrap"><UserRound size={17} /><input autoComplete="name" value={fullName} onChange={(event) => setFullName(event.target.value)} maxLength={80} placeholder="e.g. Samira Rahman" required /></span>
                </label>
              )}
              <label className="field-label">
                11-digit User ID
                <span className="field-wrap"><span className="field-prefix">ID</span><input inputMode="numeric" autoComplete="username" value={userId} onChange={(event) => setUserId(event.target.value.replace(/\D/g, "").slice(0, 11))} maxLength={11} placeholder="01234567890" required /></span>
                <span className="mt-1 block text-right text-[10px] font-normal text-[var(--muted)]">{userId.length}/11 digits</span>
              </label>
              <label className="field-label">
                Password
                <span className="field-wrap"><LockKeyhole size={17} /><input type="password" autoComplete={registering ? "new-password" : "current-password"} value={password} onChange={(event) => setPassword(event.target.value)} minLength={8} placeholder="At least 8 characters" required /></span>
              </label>
              {registering && (
                <label className="field-label">
                  Confirm password
                  <span className="field-wrap"><LockKeyhole size={17} /><input type="password" autoComplete="new-password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} minLength={8} placeholder="Enter it once more" required /></span>
                </label>
              )}
              {error && <p role="alert" className="form-notice form-error">{error}</p>}
              {success && <p role="status" className="form-notice form-success">{success}</p>}
              <button className="primary-button w-full" type="submit" disabled={pending}>
                {pending ? "Please wait..." : registering ? "Create account" : "Sign in"}
                {!pending && <ArrowRight size={17} />}
              </button>
            </form>

            <p className="mt-6 text-center text-sm text-[var(--muted)]">
              {registering ? "Already have an account? " : "New to MRH-POSTBOX? "}
              <Link className="font-semibold text-[var(--ink)] underline decoration-[var(--coral)] decoration-2 underline-offset-4" href={registering ? "/login" : "/register"}>
                {registering ? "Sign in" : "Create an account"}
              </Link>
            </p>
          </section>
        </div>

        <footer className="flex items-center justify-between border-t border-[var(--line)] pt-5 text-xs text-[var(--muted)]">
          <span>MRH-POSTBOX · Private by design</span>
          <span>Made for the people you know.</span>
        </footer>
      </div>
    </main>
  );
}