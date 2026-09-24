'use client';
import type { ReactNode } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  House, Users, CalendarBlank, UploadSimple, Warning, Coffee, SlackLogo, Gear, DownloadSimple,
} from '@phosphor-icons/react/dist/ssr';
import type { Icon } from '@phosphor-icons/react';

const ITEMS: { href: string; label: string; Icon: Icon; badge?: boolean }[] = [
  { href: '/', label: 'Overview', Icon: House },
  { href: '/people', label: 'People', Icon: Users },
  { href: '/events', label: 'Events', Icon: CalendarBlank },
  { href: '/imports', label: 'Imports', Icon: UploadSimple },
  { href: '/review', label: 'Review', Icon: Warning, badge: true },
  { href: '/coffee-chats', label: 'Coffee chats', Icon: Coffee },
  { href: '/slack', label: 'Slack', Icon: SlackLogo },
  { href: '/settings', label: 'Settings', Icon: Gear },
  { href: '/export', label: 'Export', Icon: DownloadSimple },
];

export function Sidebar(
  { email, role, reviewBadge }: { email: string; role: string; reviewBadge: ReactNode },
) {
  const pathname = usePathname();
  return (
    <aside className="flex w-[220px] shrink-0 flex-col border-r border-divider bg-bg px-[14px] pb-[18px] pt-[22px]">
      <div className="flex items-center gap-[10px] px-[10px] pb-[22px]">
        <Image src="/v1-logo.png" alt="V1" width={26} height={26} priority className="size-[26px]" />
        <div className="font-display text-[22px] tracking-[-0.02em]">GTM Dashboard</div>
      </div>

      <nav aria-label="Main navigation" className="flex flex-col gap-[2px]">
        {ITEMS.map(({ href, label, Icon, badge }) => {
          const on = href === '/' ? pathname === '/' : pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              aria-current={on ? 'page' : undefined}
              className={`flex items-center justify-between rounded-md px-[10px] py-[7px] text-[13.5px] no-underline ${
                on
                  ? 'bg-accent-subtle text-text shadow-[inset_0_0_0_1px_var(--color-accent-border)]'
                  : 'text-secondary hover:bg-surface-muted'
              }`}
            >
              <span className="flex items-center gap-[10px]">
                <span
                  aria-hidden
                  className="h-[14px] w-[3px] rounded-[2px]"
                  style={{ background: on ? 'var(--color-accent-text)' : 'transparent' }}
                />
                <Icon size={16} aria-hidden />
                {label}
              </span>
              {badge ? reviewBadge : null}
            </Link>
          );
        })}
      </nav>

      <div className="mt-auto flex flex-col gap-1 border-t border-divider px-[10px] pt-3">
        <div className="text-[12.5px]">{email.split('@')[0]}</div>
        <div className="text-[11.5px] text-muted">{email} · {role}</div>
        <form action="/auth/signout" method="post">
          <button type="submit" className="mt-1 text-[12px] text-accent-text">Sign out</button>
        </form>
      </div>
    </aside>
  );
}
