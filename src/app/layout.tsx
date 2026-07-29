import type { ReactNode } from "react";

export const metadata = {
  title: "PaperHorse",
  description: "Paper trading on real horse races.",
};

/**
 * Phase 0 is deliberately unstyled: browser defaults only, no CSS, no tokens,
 * no component library. The visual language is Phase 1 work, after the data
 * shapes are known (CLAUDE.md, docs/02 §5).
 */
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
