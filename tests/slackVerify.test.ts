import { describe, expect, it } from 'vitest';
import { signSlack, verifyHmacBase64, verifySlackSignature } from '../lib/slack/verify';
import { createHmac } from 'node:crypto';

const SECRET = 'v1-test-signing-secret';
const BODY = JSON.stringify({ type: 'event_callback', event_id: 'Ev0PV52K21' });
const NOW = 1_788_000_000_000;
const TS = String(Math.floor(NOW / 1000));

describe('slack request signing', () => {
  const sig = signSlack(BODY, TS, SECRET);

  it('accepts a signature over the raw body', () => {
    expect(verifySlackSignature(BODY, sig, TS, SECRET, NOW)).toBe(true);
  });

  it('rejects a tampered body', () => {
    expect(verifySlackSignature(`${BODY} `, sig, TS, SECRET, NOW)).toBe(false);
    expect(verifySlackSignature(BODY, sig, TS, 'other-secret', NOW)).toBe(false);
  });

  it('rejects a stale timestamp', () => {
    const old = String(Math.floor(NOW / 1000) - 6 * 60);
    expect(verifySlackSignature(BODY, signSlack(BODY, old, SECRET), old, SECRET, NOW)).toBe(false);
  });

  it('rejects a missing header or secret', () => {
    expect(verifySlackSignature(BODY, null, TS, SECRET, NOW)).toBe(false);
    expect(verifySlackSignature(BODY, sig, null, SECRET, NOW)).toBe(false);
    expect(verifySlackSignature(BODY, sig, TS, undefined, NOW)).toBe(false);
  });
});

describe('tally/luma base64 hmac', () => {
  const sig = createHmac('sha256', SECRET).update(BODY).digest('base64');

  it('accepts the raw body signature and rejects a re-serialised one', () => {
    expect(verifyHmacBase64(BODY, sig, SECRET)).toBe(true);
    // Re-serialising reorders keys/whitespace, which is exactly what must fail.
    expect(verifyHmacBase64(JSON.stringify(JSON.parse(BODY), null, 2), sig, SECRET)).toBe(false);
    expect(verifyHmacBase64(BODY, sig, undefined)).toBe(false);
  });
});
