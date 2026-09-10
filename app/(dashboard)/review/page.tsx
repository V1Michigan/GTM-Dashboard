import { listReviewItems, peopleDirectory } from '@/lib/queries';
import { ReviewQueue } from './ReviewQueue';

export default async function ReviewPage() {
  const [items, people] = await Promise.all([listReviewItems(), peopleDirectory()]);

  return <ReviewQueue items={items} people={people} />;
}
