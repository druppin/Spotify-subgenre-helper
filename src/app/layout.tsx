import type { Metadata } from "next";
import { Archivo } from "next/font/google";
import { THEME_BOOT_SCRIPT } from "@/lib/themeBoot";
import "./globals.css";

// Variable in width too, for the narrow titles and divider tabs.
const archivo = Archivo({
  variable: "--font-archivo",
  subsets: ["latin", "latin-ext"],
  axes: ["wdth"],
});

export const metadata: Metadata = {
  title: "Spotify Subgenre Assistant",
  description: "Sort tracks into playlists with AI-generated genre/mood context.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // The boot script may set data-theme before React hydrates.
    <html lang="en" className={`${archivo.variable} h-full antialiased`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
      </head>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
