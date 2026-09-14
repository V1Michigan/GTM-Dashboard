/**
 * Netlify serves every SSR route from one Lambda, and on a dashboard this quiet
 * it goes cold between visits. Measured against /login — which renders no
 * database state at all, so it is pure platform cost:
 *
 *   cold   ttfb 0.61s   total 1.72s
 *   warm   ttfb 0.21 - 0.31s
 *
 * That ~1.4s is paid by whoever opens the dashboard first. This keeps one
 * instance alive through the hours anyone is actually using it.
 *
 * /login is the target on purpose: it is in middleware's PUBLIC list so the
 * edge function short-circuits, and it queries nothing — the ping costs an
 * invocation and no database work. Warming it warms every other route, because
 * the Next runtime bundles them all into the same function.
 */
export default async () => {
  const site = process.env.URL ?? process.env.NEXT_PUBLIC_SITE_URL;
  if (!site) {
    console.warn('keep-warm: neither URL nor NEXT_PUBLIC_SITE_URL is set; skipping');
    return new Response('skipped', { status: 204 });
  }

  const started = Date.now();
  try {
    const res = await fetch(`${site}/login`, {
      headers: { 'user-agent': 'v1gtm-keep-warm' },
      cache: 'no-store',
    });
    const ms = Date.now() - started;
    // Logged so the Netlify function log shows whether this is working: once it
    // is, these numbers sit in the warm band above.
    console.log('keep-warm', { status: res.status, ms });
    return new Response(JSON.stringify({ status: res.status, ms }), {
      headers: { 'content-type': 'application/json' },
    });
  } catch (err) {
    // A failed ping must never fail the schedule; the next one is five minutes out.
    console.warn('keep-warm: ping failed', (err as Error).message);
    return new Response('ping failed', { status: 204 });
  }
};
