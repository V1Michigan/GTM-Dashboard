import { Sidebar } from '@/components/Sidebar';
import { requireAdmin } from '@/lib/auth';
import { openReviewCount } from '@/lib/queries';

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await requireAdmin();
  return (
    <div className="flex min-h-screen">
      <Sidebar email={session.email} role={session.role} reviewCount={await openReviewCount()} />
      <main className="min-w-0 flex-1 px-9 pb-10 pt-7">{children}</main>
    </div>
  );
}
