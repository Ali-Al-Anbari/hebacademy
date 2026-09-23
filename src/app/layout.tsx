import type { Metadata } from "next";
import Link from "next/link";
import { signOut } from "./auth/actions";
import { createClient } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
import { LogOut } from "lucide-react";
import "./globals.css";
import { Geist } from "next/font/google";
import { cn } from "@/lib/utils";

const geist = Geist({subsets:['latin'],variable:'--font-sans'});

export const metadata: Metadata = {
  title: "Hebacademy",
  description: "Your courses and study decks in one place.",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  const signedIn = !error && Boolean(data?.claims);

  return (
    <html lang="en" className={cn("font-sans", geist.variable)}>
      <body className="min-h-screen antialiased">
        <header className="app-header">
          <div className="mx-auto flex min-h-17 w-full max-w-6xl items-center justify-between gap-3 px-4 py-2 sm:px-8">
            <Link href="/" className="brand-mark">Hebacademy</Link>
            {signedIn && (
              <nav aria-label="Main navigation" className="flex items-center gap-1 sm:gap-2">
                <Link href="/" className="inline-flex min-h-11 items-center text-sm font-medium text-muted-foreground transition-colors hover:text-primary">Dashboard</Link>
                <form action={signOut}>
                  <Button type="submit" variant="ghost" className="text-muted-foreground"><LogOut className="hidden sm:block" /> Sign out</Button>
                </form>
              </nav>
            )}
          </div>
        </header>
        {children}
      </body>
    </html>
  );
}
