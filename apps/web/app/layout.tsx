import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'ProofMark',
  description: 'Privacy-preserving, verifiable exam workflow'
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
