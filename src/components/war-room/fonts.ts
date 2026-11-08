/**
 * War-room fonts, self-hosted by next/font (downloaded once on first compile,
 * then served locally). Exposed as CSS variables on the war-room root only,
 * so other pages keep their own type.
 */
import { Anton, Barlow, JetBrains_Mono } from "next/font/google";

const display = Anton({ weight: "400", subsets: ["latin"], variable: "--font-display", display: "swap" });
const body = Barlow({
  weight: ["400", "500", "600", "700"],
  subsets: ["latin"],
  variable: "--font-body",
  display: "swap",
});
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono", display: "swap" });

export const fontVariables = `${display.variable} ${body.variable} ${mono.variable}`;
