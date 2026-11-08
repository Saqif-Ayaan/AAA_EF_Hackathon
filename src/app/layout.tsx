import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { ThemeToggle } from "@/components/theme-toggle";
import "./globals.css";

const sans = Geist({ subsets: ["latin"], variable: "--font-sans", display: "swap" });
const mono = Geist_Mono({ subsets: ["latin"], variable: "--font-mono", display: "swap" });

export const metadata: Metadata = {
  title: "O-1A case builder",
  description: "Verify an O-1A applicant's achievements online and build an evidence-backed case.",
};

// Runs before first paint so the page never flashes the wrong theme. Dark is the default.
const THEME_SCRIPT = `try{var t=localStorage.getItem("theme");if(t!=="light")document.documentElement.classList.add("dark")}catch(e){document.documentElement.classList.add("dark")}`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="bg-white text-neutral-900 antialiased" style={{ fontFamily: "var(--font-sans), system-ui, sans-serif" }}>
        {children}
        <ThemeToggle />
      </body>
    </html>
  );
}
