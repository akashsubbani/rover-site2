import type { Metadata } from "next";
import { Archivo } from "next/font/google";
import "./globals.css";

const font = Archivo({ subsets: ["latin"], variable: "--font" });

export const metadata: Metadata = { title: "Rover Control", description: "Voice and joystick rover" };
export const viewport = { width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={font.variable}>
      <body>{children}</body>
    </html>
  );
}
