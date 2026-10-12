import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "RealEstate Agent,Inbox Pipeline Dashboard",
  description:
    "Multi-tenant Gmail/Sheets AI agent: classify, extract, cross-reference, draft. Human review before send.",
};

const NAV = [
  { href: "/", label: "Overview" },
  { href: "/inbox", label: "Inbox" },
  { href: "/drafts", label: "Drafts" },
  { href: "/tenants", label: "Tenants" },
  { href: "/logs", label: "Logs" },
];

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable}`}>
      <body className="min-h-screen bg-zinc-50 text-zinc-900 antialiased">
        <header className="border-b border-zinc-200 bg-white">
          <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
            <div className="font-semibold tracking-tight">
              RealEstate Agent
              <span className="ml-2 rounded bg-zinc-100 px-2 py-0.5 text-xs font-normal text-zinc-600">
                Next.js port
              </span>
            </div>
            <nav className="flex gap-1">
              {NAV.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="rounded px-3 py-1.5 text-sm text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900"
                >
                  {item.label}
                </Link>
              ))}
            </nav>
          </div>
        </header>
        <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
      </body>
    </html>
  );
}
