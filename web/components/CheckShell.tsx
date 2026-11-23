'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useRef, useTransition, type FormEvent, type ReactNode } from 'react';

/**
 * 입력 폼과 판정 결과를 나란히 놓는다.
 * - 판정은 서버가 검색 매개변수로 계산한다. 여기서는 값이 바뀌면 주소만 바꾼다.
 * - 자바스크립트가 없어도 폼(method="get")과 제출 버튼으로 같은 결과를 얻는다.
 */
export function CheckShell({
  fields,
  result,
  summary,
  submitLabel = '판정 보기',
}: {
  fields: ReactNode;
  result: ReactNode;
  /** 폼 아래쪽 막대에 보이는 요약(예비·최종 판정). 휴대폰에서 결과가 폼 아래로 밀려도 바로 보이게 한다 */
  summary?: ReactNode;
  submitLabel?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function syncConditional(form: HTMLFormElement) {
    const data = new FormData(form);
    for (const fieldset of form.querySelectorAll<HTMLFieldSetElement>('fieldset[data-when-field]')) {
      const current = String(data.get(fieldset.dataset.whenField ?? '') ?? '');
      const on = (fieldset.dataset.whenValues ?? '').split(' ').includes(current);
      fieldset.hidden = !on;
      fieldset.disabled = !on;
    }
  }

  function submit(form: HTMLFormElement) {
    syncConditional(form);
    const query = new URLSearchParams();
    for (const [key, value] of new FormData(form)) {
      if (typeof value === 'string' && value !== '') query.append(key, value);
    }
    const qs = query.toString();
    startTransition(() => {
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    });
  }

  function onChange(event: FormEvent<HTMLFormElement>) {
    const form = event.currentTarget;
    const target = event.target as HTMLInputElement;
    if (timer.current) clearTimeout(timer.current);
    if (target.type === 'number' || target.type === 'date' || target.type === 'text') {
      timer.current = setTimeout(() => submit(form), 450);
    } else {
      submit(form);
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] lg:items-start">
      <form
        method="get"
        action={pathname}
        noValidate
        onChange={onChange}
        onSubmit={(event) => {
          event.preventDefault();
          if (timer.current) clearTimeout(timer.current);
          submit(event.currentTarget);
        }}
        className="space-y-6 rounded-2xl border border-stone-200 bg-white p-4 shadow-sm sm:p-5 lg:sticky lg:top-20 print:hidden"
      >
        {fields}
        <div className="sticky bottom-0 z-10 -mx-4 -mb-4 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-b-2xl border-t border-stone-200 bg-white/95 px-4 py-3 backdrop-blur sm:-mx-5 sm:-mb-5 sm:px-5 lg:static lg:mx-0 lg:mb-0 lg:border-0 lg:bg-transparent lg:p-0 lg:backdrop-blur-none">
          <button
            type="submit"
            className="rounded-lg bg-teal-800 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-teal-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 focus-visible:ring-offset-2"
          >
            {submitLabel}
          </button>
          {pending ? (
            <span className="text-xs text-stone-500">판정을 다시 계산하는 중…</span>
          ) : summary ? (
            <span data-testid="summary">{summary}</span>
          ) : (
            <span className="text-xs text-stone-500">값을 바꾸면 판정이 바로 바뀝니다.</span>
          )}
        </div>
      </form>
      <div aria-busy={pending} className={`transition-opacity ${pending ? 'opacity-60' : ''}`}>
        {result}
      </div>
    </div>
  );
}
