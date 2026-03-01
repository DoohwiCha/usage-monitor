import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { LocaleProvider } from "@/lib/i18n/context";
import ErrorBoundary from "@/components/monitor/ErrorBoundary";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Usage Monitor",
  description: "Claude/OpenAI multi-account usage monitoring dashboard",
};

const initScript = `(function(){try{var t=localStorage.getItem('theme');if(t==='light')document.documentElement.setAttribute('data-theme','light');else document.documentElement.setAttribute('data-theme','dark');var l=localStorage.getItem('locale');if(l)document.documentElement.lang=l}catch(e){}})()`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={inter.variable} data-theme="dark" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: initScript }} />
      </head>
      <body className="min-h-screen antialiased">
        <ErrorBoundary>
          <LocaleProvider>{children}</LocaleProvider>
        </ErrorBoundary>
      </body>
    </html>
  );
}
