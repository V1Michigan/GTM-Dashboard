'use client';
import * as RP from '@radix-ui/react-popover';
import type { ReactNode } from 'react';

/** Surface-ground popover at --shadow-md; the trigger keeps an accent inset ring while open. */
export function Popover({ trigger, children }: { trigger: ReactNode; children: ReactNode }) {
  return (
    <RP.Root>
      <RP.Trigger asChild>{trigger}</RP.Trigger>
      <RP.Portal>
        <RP.Content
          sideOffset={6} align="end"
          className="elev-md z-50 min-w-[220px] rounded-md bg-surface p-3 text-[13px]"
        >
          {children}
        </RP.Content>
      </RP.Portal>
    </RP.Root>
  );
}
