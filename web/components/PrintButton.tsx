'use client';

export function PrintButton({ label = '인쇄·PDF로 저장' }: { label?: string }) {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm font-medium text-stone-700 shadow-sm hover:bg-stone-50 print:hidden"
    >
      {label}
    </button>
  );
}
