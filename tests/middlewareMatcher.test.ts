import { describe, expect, it } from 'vitest';
import { config } from '@/middleware';

/**
 * The matcher decides which requests the auth middleware even sees, so a typo
 * in it silently unprotects a route. Next compiles the matcher string to
 * `^<pattern>$`; this mirrors that closely enough to catch a wrong exclusion.
 */
const re = new RegExp(`^${config.matcher[0]}$`);
const runs = (path: string) => re.test(path);

describe('middleware matcher', () => {
  it('runs on every page that renders data', () => {
    for (const p of [
      '/', '/people', '/people/abc-123', '/events', '/events/new', '/review',
      '/imports', '/imports/new', '/coffee-chats', '/coffee-chats/log',
      '/slack', '/settings', '/export', '/api/export/people_wide.csv',
      '/api/imports/commit', '/auth/signout',
    ]) {
      expect(runs(p), `${p} must be checked`).toBe(true);
    }
  });

  it('skips the paths the middleware would have waved through anyway', () => {
    for (const p of [
      '/login', '/auth/callback',
      '/api/webhooks/tally', '/api/webhooks/luma', '/api/slack/events',
    ]) {
      expect(runs(p), `${p} is public, the edge function should not boot`).toBe(false);
    }
  });

  it('skips static assets', () => {
    for (const p of [
      '/_next/static/chunks/main.js', '/_next/image', '/favicon.ico', '/robots.txt',
      '/v1-logo.png', '/a.svg', '/b.jpg', '/c.jpeg', '/d.webp', '/e.avif',
      '/f.woff', '/g.woff2', '/h.map',
    ]) {
      expect(runs(p), `${p} is an asset`).toBe(false);
    }
  });

  /*
   * The exclusions are path segments, not prefixes. Without the (?:/|$) anchor
   * `/loginsomething` would slip past the auth check.
   */
  it('does not let a prefix of a public path escape the check', () => {
    for (const p of ['/loginhack', '/login-as-admin', '/api/slackers', '/authorize']) {
      expect(runs(p), `${p} must still be checked`).toBe(true);
    }
  });

  /*
   * An RSC payload request is the same pathname, so it is matched too. That is
   * deliberate: it returns page content, and a `member` must not be able to
   * prefetch an admin route's payload.
   */
  it('still covers the routes the router prefetches', () => {
    expect(runs('/people')).toBe(true);
    expect(runs('/settings')).toBe(true);
  });
});
