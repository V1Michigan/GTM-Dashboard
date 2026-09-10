import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'V1 GTM Dashboard',
  description: 'Member and event tracking for the V1 Michigan community team',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
