'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { Coffee } from '@phosphor-icons/react/dist/ssr';
import { InlineEdit } from '@/components/ui/InlineEdit';
import { Tag } from '@/components/ui/primitives';
import { gradeLabel } from '@/lib/grade';
import type { PeopleDirectoryRow, Person } from '@/lib/types';
import { setMember, updateField } from '../actions';
import { MergeDialog, type MergeSummary } from './MergeDialog';
import { DeleteDialog, type Cascades } from './DeleteDialog';
import { fmtDateLong } from '@/lib/format';

const TODAY = new Date().toISOString().slice(0, 10);
const fmt = fmtDateLong;

const TERMS = [
  { value: 'winter', label: 'Winter' }, { value: 'spring', label: 'Spring' },
  { value: 'summer', label: 'Summer' }, { value: 'fall', label: 'Fall' },
];
const LEVELS = [
  { value: 'undergrad', label: 'Undergrad' }, { value: 'graduate', label: 'Graduate' },
  { value: 'other', label: 'Other' },
];
const GENDERS = [
  { value: 'male', label: 'Male' }, { value: 'female', label: 'Female' },
  { value: 'non_binary', label: 'Non-binary' }, { value: 'prefer_not_to_say', label: 'Prefer not to say' },
];

export function PersonHeader(
  { person, name, merge, cascades, directory }:
  {
    person: Person; name: string; merge: MergeSummary;
    cascades: Cascades; directory: PeopleDirectoryRow[];
  },
) {
  const [dating, setDating] = useState(false);
  const [pending, start] = useTransition();
  const save = (field: string, value: string | null) => updateField('people', person.id, field, value);
  const grade = gradeLabel(person.grad_year);

  return (
    <div className="flex items-start justify-between gap-6">
      <div className="flex flex-1 flex-col gap-[14px]">
        <div className="flex items-center gap-3">
          <h1 className="m-0 text-[26px]">{name}</h1>
          {person.is_v1_member
            ? <Tag tone="accent">Member</Tag>
            : <Tag tone="neutral">Not a member</Tag>}
          {person.slack_joined_at && <Tag tone="outline">In Slack</Tag>}
        </div>

        <div className="grid grid-cols-6 gap-x-5 gap-y-[14px] text-[13px]">
          <InlineEdit label="First name" name="first_name" value={person.first_name} save={save} />
          <InlineEdit label="Last name" name="last_name" value={person.last_name} save={save} />
          <InlineEdit label="Uniqname" name="uniqname" value={person.uniqname} save={save} />
          <InlineEdit
            label="Grad year" name="grad_year" type="number"
            value={person.grad_year === null ? null : String(person.grad_year)} save={save}
            display={person.grad_year === null ? null : (
              <>{person.grad_year}{grade && <span className="text-neutral-500"> · {grade}</span>}</>
            )}
          />
          <InlineEdit label="Grad term" name="grad_term" value={person.grad_term} save={save} options={TERMS} />
          <InlineEdit label="Student level" name="student_level" value={person.student_level} save={save} options={LEVELS} />
          <InlineEdit
            label={<>Gender <span className="text-accent-300">· sensitive</span></>}
            name="gender" value={person.gender} save={save} options={GENDERS}
          />
          <div className="col-span-2">
            <InlineEdit label="Major" name="major" value={person.major} save={save} />
          </div>
          <ReadOnly label="Member since" value={fmt(person.member_since)} />
          <ReadOnly label="Slack joined" value={fmt(person.slack_joined_at)} />
          <div className="col-span-3">
            <InlineEdit label="Notes" name="notes" value={person.notes} save={save} />
          </div>
        </div>
      </div>

      <div className="flex w-[220px] shrink-0 flex-col gap-[6px]">
        <Link href={`/coffee-chats/log?person=${person.id}`} className="btn btn-primary w-full">
          <Coffee size={16} /> Log coffee chat
        </Link>

        {person.is_v1_member ? (
          <button
            type="button" className="btn btn-secondary w-full" disabled={pending}
            onClick={() => start(async () => { await setMember(person.id, false, null); })}
          >
            Remove V1 member
          </button>
        ) : dating ? (
          <form
            className="flex flex-col gap-[6px]"
            onSubmit={(e) => {
              e.preventDefault();
              const since = String(new FormData(e.currentTarget).get('member_since') ?? TODAY);
              start(async () => { await setMember(person.id, true, since); setDating(false); });
            }}
          >
            <label className="label-kicker" htmlFor="member_since">Member since</label>
            <input id="member_since" name="member_since" type="date" className="input" defaultValue={TODAY} />
            <div className="flex gap-2">
              <button type="submit" className="btn btn-primary" disabled={pending}>Mark as member</button>
              <button type="button" className="btn btn-ghost" onClick={() => setDating(false)}>Cancel</button>
            </div>
          </form>
        ) : (
          <button type="button" className="btn btn-secondary w-full" onClick={() => setDating(true)}>
            Mark as V1 member
          </button>
        )}

        <MergeDialog drop={merge} directory={directory} />
        <DeleteDialog
          id={person.id} name={name} cascades={cascades}
          confirmWord={person.last_name?.trim() || 'delete'}
        />
      </div>
    </div>
  );
}

function ReadOnly({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <div className="label-kicker">{label}</div>
      <div className="mt-1 text-[13px]">{value ?? <span className="text-neutral-600">—</span>}</div>
    </div>
  );
}
