import type { Metadata } from "next";
import Link from "next/link";
import { signOut } from "./auth/actions";
import { createClient } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
import { LogOut } from "lucide-react";
import { StickyNotes } from "@/components/sticky-notes";
import "./globals.css";
import { Bricolage_Grotesque, Source_Sans_3 } from "next/font/google";

const displayFont = Bricolage_Grotesque({ subsets: ["latin"], variable: "--font-display", display: "swap" });
const bodyFont = Source_Sans_3({ subsets: ["latin"], variable: "--font-body", display: "swap" });

export const metadata: Metadata = {
  title: "Hebacademy",
  description: "Your courses and study decks in one place.",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  const userId = !error ? data?.claims?.sub : null;
  const signedIn = Boolean(userId);
  const stickyNotes = userId ? await supabase.from("user_sticky_notes")
    .select("id, title, body, color, x, y, width, height, is_open, created_at, updated_at")
    .eq("user_id", userId).order("created_at", { ascending: true }) : null;
  // The optional title column is introduced by a separate, manually applied migration.
  const stickyTitleUnavailable = stickyNotes?.error?.code === "42703" && stickyNotes.error.message.includes("title");
  const legacyStickyNotes = userId && stickyTitleUnavailable ? await supabase.from("user_sticky_notes")
    .select("id, body, color, x, y, width, height, is_open, created_at, updated_at")
    .eq("user_id", userId).order("created_at", { ascending: true }) : null;

  return (
    <html lang="en" className={`${displayFont.variable} ${bodyFont.variable}`}>
      <body className="min-h-screen font-sans antialiased">
        <header className="app-header">
          <div className="mx-auto flex min-h-16 w-full max-w-6xl flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-2 sm:px-6">
            <Link href="/" className="brand-mark">Hebacademy</Link>
            {signedIn && (
              <nav aria-label="Main navigation" className="flex items-center gap-0.5 sm:gap-1">
                <Link href="/" className="app-nav-link">Dashboard</Link>
                <Link href="/planner" className="app-nav-link">Planner</Link>
                <Link href="/#study-schedules-title" className="app-nav-link">Study Schedules</Link>
                <StickyNotes userId={userId!} initialNotes={(stickyTitleUnavailable
                  ? (legacyStickyNotes?.data ?? []).map((note) => ({ ...note, title: "" }))
                  : (stickyNotes?.data ?? [])) as import("@/components/sticky-notes").StickyNoteRecord[]}
                  initialError={Boolean(stickyTitleUnavailable ? legacyStickyNotes?.error : stickyNotes?.error)} titleSupported={!stickyTitleUnavailable} />
                <form action={signOut}>
                  <Button type="submit" variant="ghost" className="px-2 text-muted-foreground sm:px-4"><LogOut className="hidden sm:block" /> Sign out</Button>
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
