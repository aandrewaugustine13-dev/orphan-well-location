import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Orphan Well Locator — West Texas",
  description:
    "Locate abandoned and orphan oil & gas wells near your property. Real-time mapping powered by PostGIS spatial queries against Texas Railroad Commission data.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
