import Link from 'next/link';
import { Logo } from './Logo';
import { NavLinks } from './NavLinks';

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-30 border-b border-stone-200/80 bg-white/90 backdrop-blur print:static print:border-0">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-6 gap-y-1 px-4 py-2">
        <Link href="/" className="flex items-center gap-2 py-1 text-[17px] font-bold tracking-tight text-teal-950">
          <Logo />
          <span>제주 그린체크</span>
          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800">시안</span>
        </Link>
        <nav aria-label="주요 메뉴" className="-mx-4 w-[calc(100%+2rem)] overflow-x-auto sm:mx-0 sm:w-auto print:hidden">
          <NavLinks />
        </nav>
      </div>
    </header>
  );
}
