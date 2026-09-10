/**
 * Row shapes for every table in supabase/migrations. Hand-written rather than
 * generated so the repo type-checks without a running database; regenerate with
 * `pnpm exec supabase gen types typescript --local > lib/types.ts` if it drifts.
 * Queries attach these with `.returns<T>()`, which also types joined shapes that
 * a generated Database type cannot express.
 */

export type Gender = 'male' | 'female' | 'non_binary' | 'prefer_not_to_say';
export type StudentLevel = 'undergrad' | 'graduate' | 'other';
export type AppRole = 'admin' | 'member';
export type GradTerm = 'winter' | 'spring' | 'summer' | 'fall';
export type Semester = 'winter' | 'fall';
export type PsRound = 'applied' | 'interview' | 'accepted' | 'completed' | 'withdrew';
export type ImportSource =
  | 'luma_csv' | 'tally_csv' | 'manual_csv' | 'tally_webhook' | 'luma_webhook' | 'slack' | 'manual';
export type ImportKind =
  | 'event_registration' | 'event_checkin' | 'interest_form' | 'community_interest_form'
  | 'product_studio_application' | 'coffee_chat' | 'members_list' | 'people_bulk'
  | 'slack_members';
export type ImportStatus = 'uploaded' | 'parsed' | 'needs_review' | 'committed' | 'failed';
export type ReviewStatus = 'open' | 'resolved' | 'dismissed';
export type ReviewKind = 'no_match' | 'ambiguous_match' | 'conflict' | 'field_conflict' | 'bad_row';
export type ImportRowStatus = 'pending' | 'applied' | 'skipped_unchanged' | 'review' | 'failed';

export type Json = string | number | boolean | null | { [k: string]: Json } | Json[];

export interface Person {
  id: string;
  first_name: string | null;
  last_name: string | null;
  full_name_normalized: string | null;
  uniqname: string | null;
  grad_year: number | null;
  grad_term: GradTerm | null;
  student_level: StudentLevel | null;
  major: string | null;
  gender: Gender | null;
  is_v1_member: boolean;
  member_since: string | null;
  slack_user_id: string | null;
  slack_joined_at: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface PersonEmail {
  id: string;
  person_id: string;
  email: string;
  email_normalized: string;
  is_primary: boolean;
  source: ImportSource;
  created_at: string;
}

export interface PersonOrganization {
  id: string; person_id: string; organization: string;
  role: string | null; source: string; created_at: string;
}

export interface EventRow {
  id: string;
  name: string;
  event_date: string;
  start_time: string | null;
  end_time: string | null;
  location: string | null;
  event_type: string | null;
  luma_event_id: string | null;
  tally_checkin_form_id: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface EventAttendance {
  id: string;
  event_id: string;
  person_id: string;
  registered: boolean;
  registered_at: string | null;
  registration_source: ImportSource | null;
  luma_approval_status: string | null;
  luma_guest_id: string | null;
  referral_source: string | null;
  utm_source: string | null;
  referred_by_email: string | null;
  checked_in: boolean;
  checked_in_at: string | null;
  checkin_source: ImportSource | null;
  checkin_answers: Record<string, Json>;
  first_import_id: string | null;
  last_import_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface FormSubmission {
  id: string; person_id: string | null; form_kind: ImportKind;
  tally_form_id: string | null; tally_submission_id: string | null;
  submitted_at: string; answers: Record<string, Json>;
  import_id: string | null; created_at: string;
}

export interface ProductStudioApplication {
  id: string; person_id: string; semester: Semester; year: number;
  round_reached: PsRound; outcome_notes: string | null;
  tally_submission_id: string | null; submitted_at: string | null;
  import_id: string | null; created_at: string; updated_at: string;
}

export interface CoffeeChat {
  id: string; person_id: string; member_id: string; chatted_on: string | null;
  notes: string | null; source: ImportSource; tally_submission_id: string | null;
  logged_by: string | null; created_at: string;
}

export interface SlackChannel {
  id: string; name: string; is_private: boolean; is_archived: boolean;
  bot_is_member: boolean; last_synced_at: string | null;
}

export interface SlackChannelActivity {
  person_id: string; channel_id: string; activity_date: string; message_count: number;
}

export interface SlackUnmatchedUser {
  slack_user_id: string; email: string | null; display_name: string | null;
  real_name: string | null; first_seen_at: string; last_seen_at: string;
  pending_message_counts: Record<string, Record<string, number>>;
}

export interface ImportRecord {
  id: string; source: ImportSource; kind: ImportKind; event_id: string | null;
  file_name: string | null; file_hash: string | null; storage_path: string | null;
  column_mapping: Record<string, string>; status: ImportStatus;
  row_count: number | null;
  rows_new: number | null; rows_updated: number | null; rows_unchanged: number | null;
  rows_review: number | null; rows_failed: number | null;
  error: string | null; uploaded_by: string | null;
  created_at: string; committed_at: string | null;
  semester: Semester | null; year: number | null; replace_roster: boolean;
  incoming_wins: boolean; allow_bad_rows: boolean;
}

export interface ImportRowRecord {
  id: string; import_id: string; row_index: number;
  raw: Record<string, Json>; parsed: Record<string, Json> | null; row_hash: string;
  person_id: string | null; match_confidence: number | null;
  status: ImportRowStatus; error: string | null;
}

export interface ReviewItem {
  id: string; kind: ReviewKind; status: ReviewStatus;
  import_row_id: string | null; slack_user_id: string | null;
  payload: Record<string, Json>; candidates: MatchCandidate[];
  resolution: Record<string, Json> | null;
  resolved_by: string | null; resolved_at: string | null; created_at: string;
}

export interface MatchCandidate {
  person_id: string; confidence: number; reason: string; display: string;
}

export interface FieldChange {
  id: number; table_name: string; row_id: string; field: string;
  old_value: Json; new_value: Json; source: ImportSource;
  import_id: string | null; changed_by: string | null; created_at: string;
}

export interface AppUser {
  email: string; role: AppRole; person_id: string | null;
  added_by: string | null; created_at: string;
}

export interface SavedColumnMapping {
  source: ImportSource; kind: ImportKind;
  mapping: Record<string, string>; updated_at: string;
}

export interface WebhookInbox {
  id: string; provider: string; received_at: string;
  headers: Record<string, Json>; payload: Json; processed: boolean; error: string | null;
}

/* Views */
export interface EventStats {
  event_id: string; name: string; event_date: string;
  registered_count: number; checked_in_count: number;
  walk_in_count: number; member_checkin_count: number;
}

export interface PersonEventSummary {
  person_id: string; events_registered: number; events_attended: number;
  last_attended_at: string | null;
}

export interface PeopleDirectoryRow {
  id: string; first_name: string | null; last_name: string | null;
  primary_email: string | null; is_v1_member: boolean;
}
