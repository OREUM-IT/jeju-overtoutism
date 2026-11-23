import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { SiteFooter } from '@/components/SiteFooter';
import { SiteHeader } from '@/components/SiteHeader';
import './globals.css';

export const metadata: Metadata = {
  title: { default: '제주 그린체크(가칭) · 우도 시범', template: '%s · 제주 그린체크' },
  description:
    '여행자·관광 사업자·정책 담당자가 "이렇게 해도 되나"를 근거 조문과 함께 확인하는 서비스 시안. 시범 지역 우도.',
};

export const viewport: Viewport = {
  themeColor: '#115e59',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ko">
      <body className="flex min-h-dvh flex-col">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-lg focus:bg-white focus:px-3 focus:py-2 focus:shadow"
        >
          본문으로 건너뛰기
        </a>
        <SiteHeader />
        <main id="main" className="mx-auto w-full max-w-5xl flex-1 px-4 pb-16 pt-6 sm:pt-10">
          {children}
        </main>
        <SiteFooter />
      </body>
    </html>
  );
}
