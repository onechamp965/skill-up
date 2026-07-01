import type { Metadata } from "next";
import "@/app/globals.css";

export const metadata: Metadata = {
  title: "News Shorts Studio",
  description: "OpenAI News의 편집적 감도를 참고해 다시 설계한 AI 뉴스 서비스"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
