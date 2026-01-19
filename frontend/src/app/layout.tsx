import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { Providers } from "@/components/providers";

// Configure Inter font
const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-sans",
});

// Application metadata
export const metadata: Metadata = {
  title: {
    default: "RAG Assistant",
    template: "%s | RAG Assistant",
  },
  description:
    "Enterprise AI assistant powered by retrieval-augmented generation. Upload documents and get intelligent answers.",
  keywords: [
    "RAG",
    "AI Assistant",
    "Document Q&A",
    "LangGraph",
    "Enterprise AI",
  ],
  authors: [{ name: "RAG Project Team" }],
  creator: "RAG Project",
  icons: {
    icon: "/favicon.ico",
  },
};

// Viewport configuration
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0a0a" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Preconnect to external domains for performance */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="anonymous"
        />
      </head>
      <body
        className={`${inter.variable} font-sans antialiased`}
        suppressHydrationWarning
      >
        {/* Client-side providers */}
        <Providers>
          {/* Main application content */}
          <div className="h-screen overflow-hidden">{children}</div>
        </Providers>

        {/* Toast notifications portal (for future use) */}
        <div id="toast-portal" />
      </body>
    </html>
  );
}
