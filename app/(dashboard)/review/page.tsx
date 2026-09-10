import { PageHeader } from '@/components/ui/primitives';
import { listReviewItems, peopleDirectory } from '@/lib/queries';
import { ReviewList } from './ReviewList';

export default async function ReviewPage() {
  const [items, people] = await Promise.all([listReviewItems(), peopleDirectory()]);

  if (items.length === 0) {
    return (
      <>
        <PageHeader title="Review queue" subtitle="0 open" />
        <div className="flex max-w-[560px] flex-col gap-2 rounded-lg border border-dashed border-neutral-700 p-12">
          <h2 className="m-0 text-[18px]">Queue is clear</h2>
          <p className="m-0 text-[14px] text-neutral-400">
            Every import row and Slack user has been matched. New items appear here when an import,
            webhook or Slack event can&rsquo;t be linked with confidence.
          </p>
        </div>
      </>
    );
  }

  return <ReviewList items={items} people={people} />;
}
