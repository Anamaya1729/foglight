import type { Metadata, Viewport } from "next";
import { Fraunces, Literata } from "next/font/google";
import "./globals.css";

/** Literata was drawn for long-form reading; Fraunces gives the headings some warmth. */
const literata = Literata({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-read",
  axes: ["opsz"],
});

const fraunces = Fraunces({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-display",
  axes: ["SOFT", "WONK", "opsz"],
});

export const metadata: Metadata = {
  title: "Foglight — read the hard books",
  description:
    "A warm, quiet reader for Dickens, Nietzsche, Tolstoy and the Brontës that stops you reading the same paragraph five times.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#faf5ec" },
    { media: "(prefers-color-scheme: dark)", color: "#17130f" },
  ],
};

/** Applies the saved theme before first paint so the page never flashes the wrong one. */
const THEME_BOOT = `try{var s=JSON.parse(localStorage.getItem('foglight:settings:v1')||'{}');
var t=s&&s.prefs&&s.prefs.theme;if(t&&t!=='system')document.documentElement.setAttribute('data-theme',t);}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${literata.variable} ${fraunces.variable}`}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
