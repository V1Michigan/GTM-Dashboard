import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'V1 GTM Dashboard',
  description: 'Member and event tracking for the V1 Michigan community team',
  // The same asset the sidebar and login mark use; it is gold on transparency,
  // so it reads on a light or dark browser tab.
  icons: { icon: '/v1-logo.png', apple: '/v1-logo.png' },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
