import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "다중 계정 사용량 모니터",
  description: "OpenAI/Anthropic 다중 계정 사용량 모니터링 대시보드",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <body className="min-h-screen antialiased">
        {children}
      </body>
    </html>
  );
}
