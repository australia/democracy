import type { Metadata } from "next";
import { Merriweather } from "next/font/google";
import "./globals.css";

const display = Merriweather({
  subsets: ["latin"],
  weight: ["400", "700"],
  variable: "--font-display",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Democracy.au — Write to your representatives",
  description:
    "Find your federal MP and Senators by entering your address. Write one message; we'll deliver it to each. Non-partisan. Open source.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en-AU" className={display.variable}>
      <body className="bg-white text-neutral-900 antialiased">{children}</body>
    </html>
  );
}
