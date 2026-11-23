import { VERDICT_INFO, type VerdictValue } from '@/lib/verdict';

const SIZES = {
  sm: 'gap-1.5 px-2 py-0.5 text-xs',
  md: 'gap-1.5 px-2.5 py-1 text-sm',
  lg: 'gap-2 px-3.5 py-1.5 text-lg',
} as const;

export function VerdictBadge({ value, size = 'md' }: { value: VerdictValue; size?: keyof typeof SIZES }) {
  const info = VERDICT_INFO[value];
  return (
    <span
      className={`inline-flex items-center whitespace-nowrap rounded-full font-semibold ring-1 ring-inset ${info.tone} ${SIZES[size]}`}
      data-verdict={value}
    >
      <span aria-hidden="true" className={`h-2 w-2 shrink-0 rounded-full ${info.dot}`} />
      {value}
    </span>
  );
}
