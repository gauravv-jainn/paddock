import type { ReactNode } from "react";
import "./globals.css";
import { isDemoData } from "@/lib/demo";
import { getCurrentUser } from "@/lib/session";

export const metadata = {
  title: "PaperHorse",
  description: "Paper trading on real horse races. No real money.",
};

/**
 * Phase 0 shell.
 *
 * Plain by instruction (CLAUDE.md): system fonts, generous spacing, one accent,
 * opaque surfaces, tabular numerals. No glass, no motion library, no component
 * library, no design tokens. The visual language is Phase 1 work.
 *
 * The skip link is first in the DOM so a keyboard user reaches it before the
 * navigation on every page (WCAG 2.2 SC 2.4.1).
 */
export default async function RootLayout({ children }: { children: ReactNode }) {
  const [user, demo] = await Promise.all([getCurrentUser(), isDemoData()]);

  return (
    <html lang="en-GB">
      <body>
        <a className="skip-link" href="#main">
          Skip to main content
        </a>

        {demo ? (
          <p className="demo-banner" role="status">
            DEMO DATA — invented horses, invented results. No real money and no
            real racing.
          </p>
        ) : null}

        <header className="site-header">
          <div className="site-header__inner">
            <a className="site-header__brand" href="/">
              PaperHorse
            </a>
            <nav className="site-nav" aria-label="Main">
              <a href="/">Meetings</a>
              <a href="/bets">My bets</a>
              <a href="/analytics">Analytics</a>
              {user ? (
                <form action="/api/auth/logout" method="post">
                  <button className="link" type="submit">
                    Sign out ({user.email})
                  </button>
                </form>
              ) : (
                <a href="/login">Sign in</a>
              )}
            </nav>
          </div>
        </header>

        {children}
      </body>
    </html>
  );
}
