import { Sidebar } from '@/components/Sidebar';
import { requireAdmin } from '@/lib/auth';
import { openReviewCount } from '@/lib/queries';

/**
 * Every page here renders live database state per request, so none of it may be
 * prerendered. Normally the `cookies()` read inside getSession() forces that,
 * but AUTH_BYPASS short-circuits before it — which silently turned these routes
 * static and baked build-time data into the HTML. Declaring it is the fix that
 * holds either way.
 */
export const dynamic = 'force-dynamic';

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await requireAdmin();
  return (
    <div className="flex min-h-screen">
      <Sidebar email={session.email} role={session.role} reviewCount={await openReviewCount()} />
      <main className="min-w-0 flex-1 px-9 pb-10 pt-7">{children}</main>
    </div>
  );
}
