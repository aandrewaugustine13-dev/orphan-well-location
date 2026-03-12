import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Orphan Well Locator",
  description: "Interactive map for locating orphan wells near Lubbock, TX",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
