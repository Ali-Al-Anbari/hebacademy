"use client";

import { useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

function signupError(code: string | undefined) {
  switch (code) {
    case "user_already_exists":
      return "An account with this email already exists. Try signing in.";
    case "email_address_invalid":
      return "Enter a valid email address.";
    case "weak_password":
      return "This password does not meet the sign-up requirements. Please try another.";
    case "over_email_send_rate_limit":
    case "over_request_rate_limit":
      return "Too many attempts. Please wait a while and try again.";
    default:
      return "Unable to create your account right now. Please try again.";
  }
}

export function SignupForm() {
  const router = useRouter();
  const submitting = useRef(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [confirmation, setConfirmation] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current) return;

    const form = event.currentTarget;
    const data = new FormData(form);
    const email = String(data.get("email") ?? "").trim();
    const password = String(data.get("password") ?? "");
    const confirmPassword = String(data.get("confirmPassword") ?? "");

    if (!email || !password || !confirmPassword) {
      setError("Complete all fields to create your account.");
      return;
    }
    if (!form.checkValidity()) {
      setError("Enter a valid email address.");
      return;
    }
    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    submitting.current = true;
    setPending(true);
    setError("");
    try {
      const supabase = createClient();
      const { data: result, error: authError } = await supabase.auth.signUp({ email, password });
      if (authError) {
        setError(signupError(authError.code));
      } else if (result.session) {
        router.replace("/");
        router.refresh();
      } else {
        setConfirmation(true);
      }
    } catch {
      setError("Unable to create your account right now. Please try again.");
    } finally {
      submitting.current = false;
      setPending(false);
    }
  }

  if (confirmation) {
    return <p role="status" className="mt-7 rounded-md bg-secondary p-4 text-sm text-foreground">Check your email to confirm your account. Once confirmed, sign in to continue.</p>;
  }

  return (
    <form onSubmit={handleSubmit} className="mt-7 space-y-5">
      <div className="space-y-2"><Label htmlFor="signup-email">Email</Label><Input id="signup-email" name="email" type="email" autoComplete="email" required placeholder="you@example.com" disabled={pending} /></div>
      <div className="space-y-2"><Label htmlFor="signup-password">Password</Label><Input id="signup-password" name="password" type="password" autoComplete="new-password" required placeholder="Create a password" disabled={pending} /></div>
      <div className="space-y-2"><Label htmlFor="signup-confirm-password">Confirm password</Label><Input id="signup-confirm-password" name="confirmPassword" type="password" autoComplete="new-password" required placeholder="Confirm your password" disabled={pending} /></div>
      {error && <p role="alert" className="notice-error text-sm">{error}</p>}
      <Button type="submit" className="w-full" disabled={pending}>{pending ? "Creating account…" : "Create Account"}</Button>
    </form>
  );
}
