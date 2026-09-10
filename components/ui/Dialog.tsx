'use client';
import * as RD from '@radix-ui/react-dialog';
import type { ReactNode } from 'react';

/**
 * Radix Dialog wearing Nocturne's `.dialog` classes. Destructive confirmations
 * start with their action disabled; that is the caller's job.
 */
export function Dialog(
  { trigger, title, children, actions, open, onOpenChange }:
  {
    trigger?: ReactNode; title: string; children: ReactNode; actions?: ReactNode;
    open?: boolean; onOpenChange?: (o: boolean) => void;
  },
) {
  return (
    <RD.Root open={open} onOpenChange={onOpenChange}>
      {trigger && <RD.Trigger asChild>{trigger}</RD.Trigger>}
      <RD.Portal>
        <RD.Overlay className="dialog-backdrop z-50" />
        <RD.Content className="dialog elev-lg fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2">
          <RD.Title className="dialog-title">{title}</RD.Title>
          <div className="dialog-body">{children}</div>
          {actions && <div className="dialog-actions">{actions}</div>}
        </RD.Content>
      </RD.Portal>
    </RD.Root>
  );
}

export const DialogClose = RD.Close;
