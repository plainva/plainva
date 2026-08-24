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
  WandSparkles,
  AppWindow,
  BellRing,
  ChartGantt,
  KeyRound,
  ShieldCheck,
  ExternalLink,
  ClipboardPaste,
  Link2,
  // lucide 1.x calls this CloudUpload; the 0.x name UploadCloud no longer exists.
  CloudUpload,
  ListChecks,
  FileCode,
  // Two offset stacked panes. Columns2 is deliberately NOT the choice: that
  // glyph already means "open in split" in this app, and reusing it for two
  // OS windows would be a double meaning.
  SquareStack,
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
    : name === 'wand' ? WandSparkles
    : name === 'tabs' ? AppWindow
    : name === 'windows' ? SquareStack
    : name === 'bell' ? BellRing
    : name === 'gantt' ? ChartGantt
    : name === 'key' ? KeyRound
    : name === 'shield' ? ShieldCheck
    : name === 'external' ? ExternalLink
    : name === 'clipboard' ? ClipboardPaste
    : name === 'link' ? Link2
    : name === 'upload' ? CloudUpload
    : name === 'tasks' ? ListChecks
    : name === 'code' ? FileCode
    : Sparkles;
  return <Glyph size={size} />;
};
