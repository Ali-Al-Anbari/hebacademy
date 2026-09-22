import type { Metadata } from "next";
import Link from "next/link";
import { signOut } from "./auth/actions";
import { createClient } from "@/lib/supabase/server";
import "./globals.css";

export const metadata: Metadata = {
  title: "Hebacademy",
  description: "Your courses and study decks in one place.",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  const signedIn = !error && Boolean(data?.claims);

  return (
    <html lang="en">
      <body className="min-h-screen bg-slate-50 font-sans text-slate-900 antialiased">
        <header className="border-b border-slate-200 bg-white">
          <div className="mx-auto flex min-h-16 w-full max-w-6xl items-center justify-between gap-3 px-4 py-2 sm:px-8">
            <Link href="/" className="text-lg font-bold tracking-tight text-teal-800 focus-visible:rounded focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700">Hebacademy</Link>
            {signedIn && (
              <nav aria-label="Main navigation" className="flex items-center gap-1 sm:gap-2">
                <Link href="/" className="rounded-lg px-2.5 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 hover:text-teal-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700 sm:px-3">Dashboard</Link>
                <form action={signOut}>
                  <button type="submit" className="min-h-11 rounded-lg px-2.5 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 hover:text-teal-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700 sm:px-3">Sign out</button>
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
