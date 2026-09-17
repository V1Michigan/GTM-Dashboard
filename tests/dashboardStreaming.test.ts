import { PassThrough } from 'node:stream';
import { createElement, Suspense } from 'react';
import { renderToPipeableStream } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import DashboardLayout from '@/app/(dashboard)/layout';
import { requireAdmin } from '@/lib/auth';
import { openReviewCount } from '@/lib/queries';

vi.mock('@/lib/auth', () => ({ requireAdmin: vi.fn() }));
vi.mock('@/lib/queries', () => ({ openReviewCount: vi.fn() }));
vi.mock('next/navigation', () => ({ usePathname: () => '/people' }));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

const admin = { email: 'admin@umich.edu', role: 'admin' as const, personId: null, userId: null };
const cleanups: (() => void)[] = [];

function renderDashboard() {
  let html = '';
  const output = new PassThrough();
  output.on('data', (chunk) => { html += chunk.toString(); });
  const errors: unknown[] = [];
  const stream = renderToPipeableStream(
    createElement('div', null,
      createElement(Suspense, { fallback: 'Waiting for authentication' },
        createElement(DashboardLayout, { children: createElement('h1', null, 'People page content') }))),
    {
      onShellReady() { stream.pipe(output); },
      onError(error) { errors.push(error); },
    },
  );
  cleanups.push(() => { stream.abort(); output.destroy(); });
  return { html: () => html, errors };
}

afterEach(() => {
  cleanups.splice(0).forEach((cleanup) => cleanup());
  vi.resetAllMocks();
});

describe('dashboard streaming', () => {
  it('renders navigation and page content before the review count resolves', async () => {
    const count = deferred<number>();
    vi.mocked(requireAdmin).mockResolvedValue(admin);
    vi.mocked(openReviewCount).mockReturnValue(count.promise);
    const rendered = renderDashboard();

    await vi.waitFor(() => {
      expect(rendered.html()).toContain('GTM Dashboard');
      expect(rendered.html()).toContain('href="/review"');
      expect(rendered.html()).toContain('People page content');
    });

    count.resolve(37);
    await vi.waitFor(() => expect(rendered.html()).toContain('37 open review items'));
    expect(rendered.errors).toEqual([]);
  });

  it('does not render the dashboard or fetch its badge until authentication finishes', async () => {
    const session = deferred<typeof admin>();
    vi.mocked(requireAdmin).mockReturnValue(session.promise);
    vi.mocked(openReviewCount).mockResolvedValue(0);
    const rendered = renderDashboard();

    await vi.waitFor(() => expect(rendered.html()).toContain('Waiting for authentication'));
    expect(rendered.html()).not.toContain('GTM Dashboard');
    expect(rendered.html()).not.toContain('People page content');
    expect(openReviewCount).not.toHaveBeenCalled();

    session.resolve(admin);
    await vi.waitFor(() => expect(rendered.html()).toContain('People page content'));
    expect(rendered.html()).not.toContain('0 open review items');
    expect(rendered.errors).toEqual([]);
  });
});
