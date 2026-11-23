import type { ReactNode } from 'react';

export function PageIntro({ eyebrow, title, children }: { eyebrow: string; title: string; children?: ReactNode }) {
  return (
    <div className="mb-6 max-w-3xl sm:mb-8">
      <p className="text-sm font-semibold text-teal-800">{eyebrow}</p>
      <h1 className="mt-1 text-2xl font-bold tracking-tight text-stone-950 sm:text-3xl">{title}</h1>
      {children ? <div className="mt-3 space-y-2 leading-relaxed text-stone-700">{children}</div> : null}
    </div>
  );
}

export function DraftNotice({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-relaxed text-amber-950">{children}</div>
  );
}
