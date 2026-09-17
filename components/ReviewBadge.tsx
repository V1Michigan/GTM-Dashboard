import { openReviewCount } from '@/lib/queries';

/** Stream only the badge; a slow count must not hold up navigation or the page. */
export async function ReviewBadge() {
  const count = await openReviewCount();
  if (count === 0) return null;

  return (
    <span
      className="rounded-[6px] bg-accent-800 px-[7px] py-px text-[11px] text-accent-100"
      aria-label={`${count} open review ${count === 1 ? 'item' : 'items'}`}
    >
      {count}
    </span>
  );
}
