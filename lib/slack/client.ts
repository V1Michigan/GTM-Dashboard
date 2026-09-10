import { WebClient, retryPolicies } from '@slack/web-api';

/**
 * False in v1 (spec §12.3): no `groups:*` scopes, no `message.groups` subscription.
 * Readable so private tracking can be switched on later without a schema change.
 */
export const TRACK_PRIVATE_CHANNELS = process.env.SLACK_TRACK_PRIVATE_CHANNELS === 'true';

let shared: WebClient | undefined;
let fast: WebClient | undefined;

/**
 * The one bot client. `fast` is for the events route, which owes Slack a 2xx in
 * three seconds and so must never sit in a retry loop; the default client retries,
 * which is what honours 429 `Retry-After` for the sync and the backfill.
 */
export function slack(opts: { fast?: boolean } = {}): WebClient {
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) throw new Error('SLACK_BOT_TOKEN is not set');
  if (opts.fast) return (fast ??= new WebClient(token, { timeout: 1500, retryConfig: { retries: 0 } }));
  return (shared ??= new WebClient(token, { retryConfig: retryPolicies.fiveRetriesInFiveMinutes }));
}

/** Walk a cursor-paginated Slack method. */
export async function* pages<R extends { response_metadata?: { next_cursor?: string } }>(
  fetchPage: (cursor?: string) => Promise<R>,
): AsyncGenerator<R> {
  let cursor: string | undefined;
  do {
    const page = await fetchPage(cursor);
    yield page;
    cursor = page.response_metadata?.next_cursor || undefined;
  } while (cursor);
}
