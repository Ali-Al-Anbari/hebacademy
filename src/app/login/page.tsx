import { signIn } from "./actions";
import Link from "next/link";
import { BookOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default async function LoginPage({
  searchParams,
}: PageProps<"/login">) {
  const { error } = await searchParams;

  return (
    <main className="page-container flex min-h-[calc(100dvh-5rem)] items-start justify-center pt-8 sm:items-center sm:py-12">
      <Card className="w-full max-w-md"><CardContent className="p-2 sm:p-4"><div className="mb-7 flex size-12 items-center justify-center rounded-2xl bg-secondary text-primary"><BookOpen className="size-6" /></div><p className="page-eyebrow">Welcome back</p><h1 className="mt-2 text-[1.85rem] font-semibold tracking-tight text-foreground">Sign in to Hebacademy</h1><p className="mt-2 text-sm leading-relaxed text-muted-foreground">Your courses, cards, and study progress are ready when you are.</p>
        <form action={signIn} className="mt-7 space-y-5"><div className="space-y-2"><Label htmlFor="email">Email</Label><Input id="email" name="email" type="email" autoComplete="email" required placeholder="you@example.com" /></div><div className="space-y-2"><Label htmlFor="password">Password</Label><Input id="password" name="password" type="password" autoComplete="current-password" required placeholder="Enter your password" /></div>{error === "invalid" && <p role="alert" className="notice-error text-sm">Unable to sign in. Check your email and password.</p>}<Button type="submit" className="mt-2 w-full">Sign in</Button></form><p className="mt-6 text-center text-sm text-muted-foreground">New to Hebacademy? <Link href="/signup" className="font-medium text-primary underline-offset-4 hover:underline focus-visible:underline">Create account</Link></p></CardContent></Card>
    </main>
  );
}
