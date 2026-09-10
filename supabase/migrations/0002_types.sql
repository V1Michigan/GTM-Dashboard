-- Spec §4.1. Enum order is load-bearing for ps_round_t: apply_import advances
-- round_reached with greatest(), which relies on declaration order.
create type gender_t as enum ('male','female','non_binary','prefer_not_to_say');
create type student_level_t as enum ('undergrad','graduate','other');
create type app_role_t as enum ('admin','member');
create type grad_term_t as enum ('winter','spring','summer','fall');
create type semester_t as enum ('winter','fall');
create type ps_round_t as enum ('applied','interview','accepted','completed','withdrew');
create type import_source_t as enum ('luma_csv','tally_csv','manual_csv','tally_webhook','luma_webhook','slack','manual');
create type import_kind_t as enum ('event_registration','event_checkin','interest_form','community_interest_form','product_studio_application','coffee_chat','members_list','people_bulk');
create type import_status_t as enum ('uploaded','parsed','needs_review','committed','failed');
create type review_status_t as enum ('open','resolved','dismissed');
create type review_kind_t as enum ('no_match','ambiguous_match','conflict','field_conflict','bad_row');

-- The only updated_at trigger function in the schema; 0007 attaches it to every
-- table that has the column.
create function set_updated_at() returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;
