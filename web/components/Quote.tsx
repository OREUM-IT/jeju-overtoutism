import type { Citation } from '@/lib/verdict';

export function Quote({ citation, index }: { citation: Citation; index?: number }) {
  return (
    <figure className="rounded-xl border border-stone-200 bg-stone-50/60 p-3" id={index ? `cite-${index}` : undefined}>
      <div className="mb-1.5 flex flex-wrap items-baseline gap-x-2 gap-y-1 text-xs">
        {index ? <span className="font-semibold text-stone-500">[{index}]</span> : null}
        <span className="chip">{citation.item_id}</span>
        <span className="text-stone-600">{citation.summary}</span>
      </div>
      {citation.quote ? (
        <blockquote className="border-l-4 border-teal-700/30 pl-3 text-[15px] leading-relaxed text-stone-800">
          “{citation.quote}”
        </blockquote>
      ) : (
        <p className="text-sm text-stone-500">카드에 인용문이 없는 항목입니다.</p>
      )}
      <figcaption className="mt-1.5 text-xs text-stone-500">
        {citation.document}
        {citation.locator ? ` · ${citation.locator}` : ''}
      </figcaption>
    </figure>
  );
}
