import { Badge, cn } from '@rozenite/ui';
import { Star } from 'lucide-react';
import { memo } from 'react';
import type { TimelineEvent } from '../shared/types';
import { channelTone, formatTime, LEVEL_TEXT_CLASS } from './format';

const LEVEL_STRIPE_CLASS = {
  debug: 'border-l-transparent',
  info: 'border-l-info',
  warn: 'border-l-warning',
  error: 'border-l-danger',
} as const;

export type EventRowProps = {
  event: TimelineEvent;
  selected: boolean;
};

export const EventRow = memo(function EventRow({ event, selected }: EventRowProps) {
  return (
    <div
      data-testid="timeline-row"
      data-level={event.level}
      data-important={event.important || undefined}
      className={cn(
        'flex min-w-0 items-center gap-2 border-l-2 px-2 py-1 text-xs',
        LEVEL_STRIPE_CLASS[event.level],
        event.important && 'bg-warning-soft',
        selected && 'bg-accent text-accent-foreground',
      )}
    >
      <span className="shrink-0 font-mono text-muted-foreground tabular-nums">
        {formatTime(event.timestamp)}
      </span>
      <Badge size="sm" tone={channelTone(event.channel)} variant="soft" className="shrink-0">
        {event.channel}
      </Badge>
      {event.important && (
        <Star aria-label="Important" className="size-3 shrink-0 fill-warning text-warning" />
      )}
      <span className={cn('shrink-0 font-mono font-semibold', LEVEL_TEXT_CLASS[event.level])}>
        {event.name}
      </span>
      {event.preview !== undefined && (
        <span className={cn('min-w-0 truncate', LEVEL_TEXT_CLASS[event.level])}>
          {event.preview}
        </span>
      )}
      {event.level !== 'info' && (
        <span className={cn('ml-auto shrink-0 uppercase', LEVEL_TEXT_CLASS[event.level])}>
          {event.level}
        </span>
      )}
    </div>
  );
});
