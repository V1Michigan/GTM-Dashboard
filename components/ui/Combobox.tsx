'use client';
import { useState } from 'react';
import { Command } from 'cmdk';
import * as RP from '@radix-ui/react-popover';

export interface ComboOption { value: string; label: string; hint?: string }

/**
 * Searchable select over a list already in memory (people directory, events).
 * `onCreate` renders the trailing "+ Add …" row when the query matches nothing.
 */
export function Combobox({
  options, value, onChange, placeholder = 'Search…', onCreate, createLabel,
}: {
  options: ComboOption[];
  value: string | null;
  onChange: (v: string) => void;
  placeholder?: string;
  onCreate?: (query: string) => void;
  createLabel?: (query: string) => string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const selected = options.find((o) => o.value === value);

  return (
    <RP.Root open={open} onOpenChange={setOpen}>
      <RP.Trigger asChild>
        <button type="button" className="input min-h-[44px] text-left">
          {selected ? selected.label : <span className="text-neutral-500">{placeholder}</span>}
        </button>
      </RP.Trigger>
      <RP.Portal>
        <RP.Content sideOffset={4} className="elev-md z-50 w-[var(--radix-popover-trigger-width)] rounded-md bg-surface p-1">
          <Command shouldFilter>
            <Command.Input
              value={query} onValueChange={setQuery}
              placeholder={placeholder} className="input mb-1"
            />
            <Command.List className="max-h-64 overflow-y-auto">
              <Command.Empty className="px-2 py-3 text-[12px] text-neutral-500">No match</Command.Empty>
              {options.map((o) => (
                <Command.Item
                  key={o.value} value={`${o.label} ${o.hint ?? ''}`}
                  onSelect={() => { onChange(o.value); setOpen(false); }}
                  className="flex min-h-[44px] cursor-pointer items-center justify-between gap-3 rounded-sm px-2 text-[13px] data-[selected=true]:bg-accent-900 data-[selected=true]:text-accent-300"
                >
                  <span>{o.label}</span>
                  {o.hint && <span className="text-[11px] text-neutral-500">{o.hint}</span>}
                </Command.Item>
              ))}
              {onCreate && query.trim() !== '' && (
                <Command.Item
                  value={`__create__${query}`} forceMount
                  onSelect={() => { onCreate(query.trim()); setOpen(false); }}
                  className="flex min-h-[44px] cursor-pointer items-center rounded-sm px-2 text-[13px] text-accent data-[selected=true]:bg-accent-900"
                >
                  {createLabel ? createLabel(query.trim()) : `+ Add “${query.trim()}”`}
                </Command.Item>
              )}
            </Command.List>
          </Command>
        </RP.Content>
      </RP.Portal>
    </RP.Root>
  );
}
