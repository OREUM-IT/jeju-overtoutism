import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="max-w-xl space-y-3">
      <h1 className="text-2xl font-bold text-stone-950">찾는 화면이 없습니다</h1>
      <p className="text-stone-700">주소가 바뀌었거나 아직 만들지 않은 카드일 수 있습니다.</p>
      <p>
        <Link href="/" className="link">
          홈으로
        </Link>{' '}
        ·{' '}
        <Link href="/cards" className="link">
          규제 카드 목록
        </Link>
      </p>
    </div>
  );
}
