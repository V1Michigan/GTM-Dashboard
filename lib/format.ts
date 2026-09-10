import type { ImportKind } from '@/lib/types';

/**
 * Display formatting shared by Server and Client Components.
 *
 * This file must NOT carry 'use client'. Next turns every export of a client
 * module into a client reference, so a plain function defined in one throws
 * "Attempted to call X() from the server" when a Server Component calls it.
 *
 * Two kinds of value, and mixing them up shifts dates by a day:
 *   - timestamptz (`created_at`, `checked_in_at`) is an instant, so it is
 *     converted into the club's timezone.
 *   - date-only (`event_date`, `chatted_on`, `member_since`) is a calendar date
 *     with no instant attached; it is rendered verbatim. Running it through a
 *     timezone would turn 2026-09-09 into Sep 8 for anyone west of UTC.
 */
const TZ = 'America/Detroit';

const dateTime = new Intl.DateTimeFormat('en-US', {
  month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  hour12: false, timeZone: TZ,
});
const dateOnly = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
const dateLong = new Intl.DateTimeFormat('en-US', {
  month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC',
});
const dayDate = new Intl.DateTimeFormat('en-US', {
  weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC',
});
const dayDateLong = new Intl.DateTimeFormat('en-US', {
  weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC',
});
const timeOnly = new Intl.DateTimeFormat('en-US', {
  hour: 'numeric', minute: '2-digit', timeZone: TZ,
});

const DASH = '—';

/** A timestamptz, in the club's timezone. */
export const fmtDateTime = (iso: string | null | undefined) =>
  iso ? dateTime.format(new Date(iso)) : DASH;

/** A date-only column (`YYYY-MM-DD`), rendered as written. */
export const fmtDate = (d: string | null | undefined) =>
  d ? dateOnly.format(new Date(`${d.slice(0, 10)}T00:00:00Z`)) : DASH;

/** A date-only column with the year, e.g. `Sep 9, 2026`. */
export const fmtDateLong = (d: string | null | undefined) =>
  d ? dateLong.format(new Date(`${d.slice(0, 10)}T00:00:00Z`)) : DASH;

/** A date-only column with the weekday, e.g. `Wed, Sep 9`. */
export const fmtDayDate = (d: string | null | undefined) =>
  d ? dayDate.format(new Date(`${d.slice(0, 10)}T00:00:00Z`)) : DASH;

/** A date-only column with weekday and year, e.g. `Wed, Sep 9, 2026`. */
export const fmtDayDateLong = (d: string | null | undefined) =>
  d ? dayDateLong.format(new Date(`${d.slice(0, 10)}T00:00:00Z`)) : DASH;

/** The clock time of a timestamptz, in the club's timezone. */
export const fmtTime = (iso: string | null | undefined) =>
  iso ? timeOnly.format(new Date(iso)) : DASH;

export const KIND_LABEL: Record<ImportKind, string> = {
  event_registration: 'Event registration',
  event_checkin: 'Event check-in',
  interest_form: 'Interest form',
  community_interest_form: 'Community interest form',
  product_studio_application: 'PS application',
  coffee_chat: 'Coffee chat',
  members_list: 'Members list',
  people_bulk: 'People bulk',
};
