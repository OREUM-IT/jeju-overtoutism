'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

export const NAV_LINKS = [
  { href: '/check', label: '방문 전 체크' },
  { href: '/plan', label: '기획 점검' },
  { href: '/report', label: '지역 보고서' },
  { href: '/cards', label: '규제 카드' },
] as const;

export function NavLinks() {
  const pathname = usePathname();
  return (
    <ul className="flex gap-1 whitespace-nowrap px-2 sm:px-0">
      {NAV_LINKS.map((link) => {
        const active = pathname === link.href || pathname.startsWith(`${link.href}/`);
        return (
          <li key={link.href}>
            <Link
              href={link.href}
              aria-current={active ? 'page' : undefined}
              className={`inline-block rounded-lg px-3 py-2 text-sm font-medium transition ${
                active ? 'bg-teal-50 text-teal-900' : 'text-stone-600 hover:bg-stone-100 hover:text-stone-900'
              }`}
            >
              {link.label}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
