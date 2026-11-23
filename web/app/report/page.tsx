import type { Metadata } from 'next';
import Link from 'next/link';
import { PageIntro } from '@/components/PageIntro';
import { PrintButton } from '@/components/PrintButton';
import { ReportView } from '@/components/ReportView';
import { todayKst } from '@/lib/format';
import { AUDIENCES, buildReport, parseAudience } from '@/lib/report';

export const metadata: Metadata = {
  title: '지역 진단 보고서',
  description: '우도의 규제 현황, 진단과 대응 방향, 에코투어리즘 아이템 후보, 근거와 한계를 독자별로 보여 줍니다.',
};

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function ReportPage({ searchParams }: { searchParams: SearchParams }) {
  const audience = parseAudience((await searchParams).audience);
  const report = buildReport(audience, todayKst());

  return (
    <>
      <PageIntro eyebrow="정책 담당자·관광 기획자 · 우도" title="지역 진단 보고서">
        <p>같은 근거(규제 카드와 수집 대상 목록)에서 독자별로 다른 보고서를 만듭니다. 서술마다 근거 인용이나 “확인 필요”, “제안” 표시가 붙습니다.</p>
      </PageIntro>

      <div className="mb-6 flex flex-wrap items-center justify-between gap-3 print:hidden">
        <nav aria-label="독자 선택">
          <ul className="flex flex-wrap gap-1 rounded-xl bg-stone-200/60 p-1">
            {AUDIENCES.map((a) => (
              <li key={a.value}>
                <Link
                  href={a.value === 'policy' ? '/report' : `/report?audience=${a.value}`}
                  aria-current={a.value === audience ? 'page' : undefined}
                  className={`inline-block rounded-lg px-3 py-1.5 text-sm font-medium ${
                    a.value === audience ? 'bg-white text-stone-950 shadow-sm' : 'text-stone-600 hover:text-stone-900'
                  }`}
                >
                  {a.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <div className="flex items-center gap-2">
          <a href={`/api/report?audience=${audience}`} className="text-sm text-stone-600 underline-offset-2 hover:underline">
            JSON
          </a>
          <PrintButton />
        </div>
      </div>

      <ReportView report={report} />
    </>
  );
}
