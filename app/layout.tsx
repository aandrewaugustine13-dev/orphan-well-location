import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Orphan Well Locator — United States",
  description:
    "Locate abandoned and orphan oil & gas wells near your property. 120,000+ wells mapped across 27 states using USGS and state regulatory data.",
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
