import { tags, withCache } from '@/lib/cache';
import { fetchAll } from '@/lib/paginate';
import { createServerClient } from '@/lib/supabase/server';
import type {
  AppUser, CoffeeChat, EventAttendance, EventRow, EventStats, FieldChange, FormSubmission,
  ImportRecord, ImportRowRecord, PeopleDirectoryRow, Person, PersonEmail, PersonEventSummary,
  PersonOrganization, ProductStudioApplication, ReviewItem, SavedColumnMapping, SlackChannel,
  SlackChannelActivity, SlackUnmatchedUser,
} from '@/lib/types';

/**
 * The read layer. Every page renders from one of these; each goes through
 * `withCache()` with the tags a write path revalidates (spec §0.2). Nothing here
 * recomputes a count in JS — counts come from the SQL views.
 */

/* ── People ───────────────────────────────────────────────────────────── */

export interface PersonListRow extends Person {
  primary_email: string | null;
  email_count: number;
  events_registered: number;
  events_attended: number;
  ps_applications: number;
  coffee_chats: number;
}

export const listPeople = () =>
  withCache(['people-list'], [tags.people], async (db) => {
    return fetchAll<PersonListRow>((f, t) =>
      db.from('people_list').select('*').order('id').range(f, t));
  });

export interface PersonDetail {
  person: Person;
  emails: PersonEmail[];
  attendance: (EventAttendance & { event: EventRow })[];
  submissions: FormSubmission[];
  applications: ProductStudioApplication[];
  chats: (CoffeeChat & { other: Pick<Person, 'id' | 'first_name' | 'last_name'>; direction: 'gave' | 'received' })[];
  slack: (SlackChannelActivity & { channel: SlackChannel })[];
  organizations: PersonOrganization[];
  audit: FieldChange[];
  summary: PersonEventSummary | null;
}

export const getPerson = (id: string) =>
  withCache(['person', id], [tags.person(id), tags.people], async (db): Promise<PersonDetail | null> => {
    const [person, emails, attendance, submissions, applications, chats, slack, organizations, audit, summary] =
      await Promise.all([
        db.from('people').select('*').eq('id', id).maybeSingle(),
        db.from('person_emails').select('*').eq('person_id', id).order('is_primary', { ascending: false }),
        db.from('event_attendance').select('*, event:events(*)').eq('person_id', id),
        db.from('form_submissions').select('*').eq('person_id', id).order('submitted_at', { ascending: false }),
        db.from('product_studio_applications').select('*').eq('person_id', id),
        db.from('coffee_chats')
          .select('*, person:person_id(id,first_name,last_name), member:member_id(id,first_name,last_name)')
          .or(`person_id.eq.${id},member_id.eq.${id}`),
        db.from('slack_channel_activity').select('*, channel:slack_channels(*)').eq('person_id', id),
        db.from('person_organizations').select('*').eq('person_id', id),
        db.from('field_changes').select('*').eq('row_id', id).order('created_at', { ascending: false }).limit(20),
        db.from('person_event_summary').select('*').eq('person_id', id).maybeSingle(),
      ]);
    if (!person.data) return null;
    type ChatJoin = CoffeeChat & { person: Person; member: Person };
    return {
      person: person.data as Person,
      emails: (emails.data ?? []) as PersonEmail[],
      attendance: (attendance.data ?? []) as PersonDetail['attendance'],
      submissions: (submissions.data ?? []) as FormSubmission[],
      applications: (applications.data ?? []) as ProductStudioApplication[],
      chats: ((chats.data ?? []) as ChatJoin[]).map((r) => ({
        ...r,
        other: r.person_id === id ? r.member : r.person,
        direction: r.member_id === id ? ('gave' as const) : ('received' as const),
      })),
      slack: (slack.data ?? []) as PersonDetail['slack'],
      organizations: (organizations.data ?? []) as PersonOrganization[],
      audit: (audit.data ?? []) as FieldChange[],
      summary: (summary.data ?? null) as PersonEventSummary | null,
    };
  });

/** Name + primary email only. This is the one people view the `member` role may read. */
export const peopleDirectory = () =>
  withCache(['people-directory'], [tags.people], async (db) => {
    return fetchAll<PeopleDirectoryRow>((f, t) =>
      db.from('people_directory').select('*').order('last_name').order('id').range(f, t));
  });

/** Uncached: called from the member page, which must not share a cache entry. */
export async function peopleDirectoryLive(): Promise<PeopleDirectoryRow[]> {
  const db = await createServerClient();
  return fetchAll<PeopleDirectoryRow>((f, t) =>
    db.from('people_directory').select('*').order('last_name').order('id').range(f, t));
}

/* ── Events ───────────────────────────────────────────────────────────── */

export type EventListRow = EventRow & Omit<EventStats, 'event_id' | 'name' | 'event_date'> & {
  open_review_items: number;
};

export const listEvents = () =>
  withCache(['events-list'], [tags.events], async (db): Promise<EventListRow[]> => {
    const { data, error } = await db.from('events_list').select('*')
      .order('event_date', { ascending: false });
    if (error) throw error;
    return (data ?? []) as EventListRow[];
  });

export interface EventAttendee extends EventAttendance {
  person: Pick<Person, 'id' | 'first_name' | 'last_name' | 'is_v1_member'> & { primary_email: string | null };
}

type Join = EventAttendance & {
  person: Person & { person_emails: { email: string; is_primary: boolean }[] };
};

export const getEvent = (id: string) =>
  withCache(['event', id], [tags.event(id), tags.events], async (db) => {
    const [event, stats, attendees, imports] = await Promise.all([
      db.from('events').select('*').eq('id', id).maybeSingle(),
      db.from('event_stats').select('*').eq('event_id', id).maybeSingle(),
      fetchAll<Join>((f, t) => db.from('event_attendance')
        .select('*, person:people(id,first_name,last_name,is_v1_member,person_emails(email,is_primary))')
        .eq('event_id', id).order('id').range(f, t)),
      db.from('imports').select('*').eq('event_id', id).order('created_at', { ascending: false }),
    ]);
    if (!event.data) return null;
    return {
      event: event.data as EventRow,
      stats: (stats.data ?? null) as EventStats | null,
      attendees: attendees.map((r) => ({
        ...r,
        person: {
          ...r.person,
          primary_email:
            r.person?.person_emails?.find((e) => e.is_primary)?.email
            ?? r.person?.person_emails?.[0]?.email ?? null,
        },
      })) as EventAttendee[],
      imports: (imports.data ?? []) as ImportRecord[],
    };
  });

/** Minimal list for the wizard's event combobox and the "pick an event" step. */
export const eventOptions = () =>
  withCache(['event-options'], [tags.events], async (db) => {
    const { data } = await db.from('events').select('id,name,event_date')
      .order('event_date', { ascending: false });
    return (data ?? []) as Pick<EventRow, 'id' | 'name' | 'event_date'>[];
  });

/* ── Imports ──────────────────────────────────────────────────────────── */

export const listImports = () =>
  withCache(['imports-list'], [tags.imports], async (db) => {
    const { data, error } = await db.from('imports').select('*, event:events(*)')
      .order('created_at', { ascending: false });
    if (error) throw error;
    return (data ?? []) as (ImportRecord & { event: EventRow | null })[];
  });

export const getImport = (id: string) =>
  withCache(['import', id], [tags.imports, tags.review], async (db) => {
    const [record, rows, review] = await Promise.all([
      db.from('imports').select('*, event:events(*)').eq('id', id).maybeSingle(),
      fetchAll<ImportRowRecord & { person: Person | null }>((f, t) =>
        db.from('import_rows').select('*, person:people(id,first_name,last_name)')
          .eq('import_id', id).order('row_index').range(f, t)),
      db.from('review_items').select('id, import_rows!inner(import_id)')
        .eq('status', 'open').eq('import_rows.import_id', id),
    ]);
    if (!record.data) return null;
    return {
      record: record.data as ImportRecord & { event: EventRow | null },
      rows,
      openReviewCount: review.data?.length ?? 0,
    };
  });

export const savedMappings = () =>
  withCache(['saved-mappings'], [tags.imports], async (db) => {
    const { data } = await db.from('saved_column_mappings').select('*');
    return (data ?? []) as SavedColumnMapping[];
  });

/* ── Review ───────────────────────────────────────────────────────────── */

export const openReviewCount = () =>
  withCache(['review-count'], [tags.review], async (db) => {
    const { count } = await db.from('review_items')
      .select('id', { count: 'exact', head: true }).eq('status', 'open');
    return count ?? 0;
  });

export const listReviewItems = () =>
  withCache(['review-items'], [tags.review], async (db) => {
    return fetchAll<ReviewItem>((f, t) => db.from('review_items').select('*')
      .eq('status', 'open').order('created_at').order('id').range(f, t));
  });

/* ── Coffee chats ─────────────────────────────────────────────────────── */

export interface CoffeeChatRow extends CoffeeChat {
  person: Pick<Person, 'id' | 'first_name' | 'last_name'>;
  member: Pick<Person, 'id' | 'first_name' | 'last_name'>;
}

const CHAT_SELECT =
  '*, person:person_id(id,first_name,last_name), member:member_id(id,first_name,last_name)';

export const listCoffeeChats = () =>
  withCache(['coffee-chats'], [tags.coffeeChats], async (db) => {
    return fetchAll<CoffeeChatRow>((f, t) => db.from('coffee_chats').select(CHAT_SELECT)
      .order('chatted_on', { ascending: false }).order('id').range(f, t)) as Promise<CoffeeChatRow[]>;
  });

/** Uncached on purpose: RLS scopes this per member, so it must not be shared. */
export async function myCoffeeChats(memberId: string): Promise<CoffeeChatRow[]> {
  const db = await createServerClient();
  const { data } = await db.from('coffee_chats').select(CHAT_SELECT)
    .eq('member_id', memberId).order('created_at', { ascending: false }).limit(20);
  return (data ?? []) as unknown as CoffeeChatRow[];
}

/* ── Slack ────────────────────────────────────────────────────────────── */

export interface SlackChannelStats extends SlackChannel {
  active_people: number; messages_7d: number; messages_30d: number; messages_all: number;
}

export const slackOverview = () =>
  withCache(['slack-overview'], [tags.slack], async (db) => {
    const [channels, unmatched, notInSlack] = await Promise.all([
      db.from('slack_channel_stats').select('*').order('messages_30d', { ascending: false }),
      db.from('slack_unmatched_users').select('*').order('last_seen_at', { ascending: false }),
      db.from('people').select('id,first_name,last_name')
        .eq('is_v1_member', true).is('slack_joined_at', null),
    ]);
    return {
      channels: (channels.data ?? []) as SlackChannelStats[],
      unmatched: (unmatched.data ?? []) as SlackUnmatchedUser[],
      notInSlack: (notInSlack.data ?? []) as Pick<Person, 'id' | 'first_name' | 'last_name'>[],
    };
  });

/* ── Overview + settings ──────────────────────────────────────────────── */

export interface OverviewStats {
  total_people: number; members: number; in_slack: number;
  events_this_semester: number; open_review_items: number;
}

export const overview = () =>
  withCache(
    ['overview'],
    [tags.overview, tags.people, tags.events, tags.review, tags.slack],
    async (db) => {
      const [stats, checkins, slackBars, imports, upcoming] = await Promise.all([
        db.from('overview_stats').select('*').maybeSingle(),
        db.from('event_stats').select('*').order('event_date'),
        db.from('slack_channel_stats').select('name,messages_30d')
          .order('messages_30d', { ascending: false }).limit(8),
        db.from('imports').select('*, event:events(name)').order('created_at', { ascending: false }).limit(5),
        db.from('events').select('id,name,event_date,event_type')
          .gte('event_date', new Date().toISOString().slice(0, 10)).order('event_date').limit(5),
      ]);
      return {
        stats: (stats.data ?? null) as OverviewStats | null,
        checkins: (checkins.data ?? []) as EventStats[],
        slackBars: (slackBars.data ?? []) as { name: string; messages_30d: number }[],
        imports: (imports.data ?? []) as (ImportRecord & { event: { name: string } | null })[],
        upcoming: (upcoming.data ?? []) as Pick<EventRow, 'id' | 'name' | 'event_date' | 'event_type'>[],
      };
    },
  );

export const appUsers = () =>
  withCache(['app-users'], [tags.appUsers], async (db) => {
    const { data } = await db.from('app_users')
      .select('*, person:people(id,first_name,last_name)').order('role').order('email');
    return (data ?? []) as (AppUser & { person: Person | null })[];
  });
