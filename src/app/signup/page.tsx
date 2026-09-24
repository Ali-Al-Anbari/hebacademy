import Link from "next/link";
import { BookOpen } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { SignupForm } from "./signup-form";

export default async function SignupPage() {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  if (!error && data?.claims) redirect("/");

  return (
    <main className="page-container flex min-h-[calc(100dvh-5rem)] items-start justify-center pt-8 sm:items-center sm:py-12">
      <Card className="auth-card w-full max-w-md py-0">
        <CardContent className="p-7 sm:p-9">
          <div className="auth-mark mb-7 flex size-12 items-center justify-center rounded-xl"><BookOpen className="size-6" /></div>
          <p className="page-eyebrow">Get started</p>
          <h1 className="mt-2 text-[1.7rem] font-semibold tracking-tight text-foreground">Create your account</h1>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">Start organizing your courses and studying your cards.</p>
          <SignupForm />
          <p className="mt-6 text-center text-sm text-muted-foreground">Already have an account? <Link href="/login" className="font-semibold text-brand-ink underline-offset-4 hover:underline focus-visible:underline">Sign in</Link></p>
        </CardContent>
      </Card>
    </main>
  );
}
