import React from 'react';
import {
  Cloud,
  LayoutPanelLeft,
  Mail,
  Repeat,
  Database,
  RefreshCw,
  Download,
  Lock,
  Trash2,
  CalendarDays,
  Smartphone,
  Paperclip,
  Sparkles,
} from 'lucide-react';
import type { WhatsNewIconName } from '../lib/whatsNew';

/**
 * The glyph for a release highlight.
 *
 * The catalog names an icon, this maps it — so a release entry stays data both
 * shells can read, and neither has to know what lucide calls the glyph. An
 * unknown name falls back rather than rendering nothing: a missing icon would
 * collapse the row's layout, and a release note is not worth a broken dialog.
 */
export const WhatsNewIcon: React.FC<{ name: WhatsNewIconName; size: number }> = ({ name, size }) => {
  const Glyph =
    name === 'cloud' ? Cloud
    : name === 'layout' ? LayoutPanelLeft
    : name === 'mail' ? Mail
    : name === 'repeat' ? Repeat
    : name === 'database' ? Database
    : name === 'sync' ? RefreshCw
    : name === 'import' ? Download
    : name === 'lock' ? Lock
    : name === 'trash' ? Trash2
    : name === 'calendar' ? CalendarDays
    : name === 'phone' ? Smartphone
    : name === 'paperclip' ? Paperclip
    : Sparkles;
  return <Glyph size={size} />;
};
