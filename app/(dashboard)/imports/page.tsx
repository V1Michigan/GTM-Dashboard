import Link from 'next/link';
import { PageHeader } from '@/components/ui/primitives';
import { listImports } from '@/lib/queries';
import { ImportsTable } from './ImportsTable';

export default async function ImportsPage() {
  const imports = await listImports();
  const needsReview = imports.filter((i) => i.status === 'needs_review').length;
  const failed = imports.filter((i) => i.status === 'failed').length;

  return (
    <>
      <PageHeader
        title="Imports"
        subtitle={`${imports.length} imports · ${needsReview} needs review · ${failed} failed`}
        actions={<Link href="/imports/new" className="btn btn-primary no-underline">New import</Link>}
      />
      <ImportsTable rows={imports} />
    </>
  );
}
