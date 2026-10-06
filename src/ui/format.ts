import type { Tone } from '@rozenite/ui';
import type { TimelineEvent, TimelineLevel } from '../shared/types';

const pad = (value: number, length = 2) => String(value).padStart(length, '0');

/** `HH:MM:SS.mmm` in local time. */
export const formatTime = (timestamp: number): string => {
  const date = new Date(timestamp);
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(
    date.getMilliseconds(),
    3,
  )}`;
};

export const LEVEL_TONE: Record<TimelineLevel, Tone> = {
  debug: 'neutral',
  info: 'info',
  warn: 'warning',
  error: 'danger',
};

/** Row text colour per level; `info` keeps the default foreground. */
export const LEVEL_TEXT_CLASS: Record<TimelineLevel, string> = {
  debug: 'text-muted-foreground',
  info: 'text-foreground',
  warn: 'text-warning',
  error: 'text-danger',
};

// Level tones (warning, danger) are left out so a channel badge never reads
// as a severity.
const CHANNEL_TONES: Tone[] = ['primary', 'info', 'success', 'neutral'];

/** A stable tone per channel name. */
export const channelTone = (channel: string): Tone => {
  let hash = 0;
  for (let index = 0; index < channel.length; index += 1) {
    hash = (hash * 31 + channel.charCodeAt(index)) | 0;
  }
  return CHANNEL_TONES[Math.abs(hash) % CHANNEL_TONES.length];
};

export const toPrettyJson = (value: unknown): string => {
  try {
    return JSON.stringify(value, null, 2) ?? 'undefined';
  } catch {
    return String(value);
  }
};

export const buildExport = (events: TimelineEvent[], filters: Record<string, unknown>) =>
  toPrettyJson({
    exportedAt: new Date().toISOString(),
    filters,
    count: events.length,
    events,
  });

/** Triggers a file download. Returns false when the host blocks it. */
export const downloadText = (fileName: string, text: string): boolean => {
  try {
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = fileName;
    anchor.style.display = 'none';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return true;
  } catch {
    return false;
  }
};
