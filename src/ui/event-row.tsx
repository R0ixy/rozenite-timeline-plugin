import { Badge, cn } from '@rozenite/ui';
import { Star } from 'lucide-react';
import { memo } from 'react';
import type { TimelineEvent } from '../shared/types';
import { channelTone, formatTime, LEVEL_STYLE } from './format';

export type EventRowProps = {
  event: TimelineEvent;
  selected: boolean;
};

export const EventRow = memo(function EventRow({ event, selected }: EventRowProps) {
  const style = LEVEL_STYLE[event.level];
  return (
    <div
      data-testid="timeline-row"
      data-level={event.level}
      data-important={event.important || undefined}
      className={cn(
        'flex min-w-0 items-center gap-2 border-l-2 px-2 py-1 text-xs',
        style.stripe,
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
      <span className={cn('shrink-0 font-mono font-semibold', style.text)}>
        {event.name}
      </span>
      {event.preview !== undefined && (
        <span className={cn('min-w-0 truncate', style.text)}>
          {event.preview}
        </span>
      )}
      {event.level !== 'info' && (
        <span className={cn('ml-auto shrink-0 uppercase', style.text)}>
          {event.level}
        </span>
      )}
    </div>
  );
});
