import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Manimate",
  description: "Create beautiful math animations with AI",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://cdn.jsdelivr.net" crossOrigin="anonymous" />
        <link href="https://cdn.jsdelivr.net/gh/bitmaks/cm-web-fonts@latest/font/Serif/cmun-serif.css" rel="stylesheet" />
      </head>
      <body className="antialiased">
        {children}
      </body>
    </html>
  );
}
