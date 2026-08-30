import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "nuni",
  description: "Say what you want on the cloth and it builds you the controls to do it.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-[#0e0d0c] text-stone-200 antialiased">{children}</body>
    </html>
  );
}
