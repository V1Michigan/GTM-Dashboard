import { createHmac, timingSafeEqual } from 'node:crypto';

const FIVE_MINUTES = 5 * 60;

/** Constant-time string compare. Length mismatch is a miss, without leaking where. */
function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a, 'utf8');
  const y = Buffer.from(b, 'utf8');
  return x.length === y.length && timingSafeEqual(x, y);
}

/** `v0=` + HMAC-SHA256 of `v0:<timestamp>:<raw body>` (spec §8.1). */
export function signSlack(raw: string, timestamp: string, secret: string): string {
  return `v0=${createHmac('sha256', secret).update(`v0:${timestamp}:${raw}`).digest('hex')}`;
}

/**
 * Verify a Slack request. `raw` MUST be the untouched request body: parsing and
 * re-serialising JSON changes the bytes and therefore the digest.
 * Requests older (or newer) than five minutes are replays and are rejected.
 */
export function verifySlackSignature(
  raw: string,
  signature: string | null,
  timestamp: string | null,
  secret: string | undefined = process.env.SLACK_SIGNING_SECRET,
  nowMs: number = Date.now(),
): boolean {
  if (!signature || !timestamp || !secret) return false;
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(nowMs / 1000 - ts) > FIVE_MINUTES) return false;
  return safeEqual(signSlack(raw, timestamp, secret), signature);
}

/**
 * Tally and Luma both sign with base64(HMAC-SHA256(secret, raw body))
 * (spec §11.1, §11.2). Same rule: verify the raw bytes, never a re-serialised object.
 */
export function verifyHmacBase64(
  raw: string,
  signature: string | null,
  secret: string | undefined,
): boolean {
  if (!signature || !secret) return false;
  return safeEqual(createHmac('sha256', secret).update(raw, 'utf8').digest('base64'), signature);
}
