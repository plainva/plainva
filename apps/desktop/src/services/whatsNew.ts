/**
 * Catalog and service for What's New release highlights.
 */

export interface WhatsNewItem {
  version: string;
  releaseDate: string;
  title: string;
  highlights: string[];
  blogUrl?: string;
}

export const WHATS_NEW_CATALOG: WhatsNewItem[] = [
  {
    version: '0.4.6',
    releaseDate: '2026-07-24',
    title: 'Release Highlights v0.4.6',
    highlights: [
      '⚡ PKM-Import Engine: Direkter Import aus Notion, Evernote, Google Keep, Logseq & Simplenote',
      '🎨 Design Language 2.0: 100% Token-Striktheit & 14 vollständige Themes (inkl. LCARS & Win95)',
      '📱 Live-QR-Scan & Mobile App Optimierungen',
      '🔒 Robuste Vault-Isolation & Verschlüsselung',
    ],
    blogUrl: 'https://plainva.com/de/blog/release-0-4-6',
  },
];

export function getLatestWhatsNew(): WhatsNewItem {
  return WHATS_NEW_CATALOG[0];
}

export function shouldShowWhatsNew(seenVersion: string | null | undefined, currentVersion: string): boolean {
  if (!seenVersion) return true;
  return seenVersion !== currentVersion;
}
