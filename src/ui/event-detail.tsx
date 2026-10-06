import { Badge, Button, IconButton, JsonInspector, useCopyToClipboard, X } from '@rozenite/ui';
import { Check, Copy } from 'lucide-react';
import type { TimelineEvent } from '../shared/types';
import { channelTone, formatTime, LEVEL_TONE, toPrettyJson } from './format';

export type EventDetailProps = {
  event: TimelineEvent;
  onClose: () => void;
};

const MetaRow = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <>
    <dt className="text-muted-foreground">{label}</dt>
    <dd className="min-w-0 font-mono break-all text-foreground">{children}</dd>
  </>
);

export function EventDetail({ event, onClose }: EventDetailProps) {
  const payloadCopy = useCopyToClipboard();
  const eventCopy = useCopyToClipboard();
  const hasPayload = event.payload !== undefined;

  return (
    <section aria-label="Event details" className="flex h-full min-h-0 flex-col bg-background">
      <header className="flex items-center gap-2 border-b border-border px-3 py-2">
        <Badge tone={channelTone(event.channel)} variant="soft">
          {event.channel}
        </Badge>
        <h2 className="min-w-0 flex-1 truncate font-mono text-sm font-semibold text-foreground">
          {event.name}
        </h2>
        <IconButton
          tone="neutral"
          variant="ghost"
          size="sm"
          label="Close details"
          onClick={onClose}
        >
          <X />
        </IconButton>
      </header>

      <div className="min-h-0 flex-1 overflow-auto px-3 py-2">
        {event.preview !== undefined && (
          <p className="mb-2 text-sm break-words text-foreground">{event.preview}</p>
        )}

        <dl className="mb-3 grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1 text-xs">
          <MetaRow label="Time">
            {formatTime(event.timestamp)}{' '}
            <span className="text-muted-foreground">({new Date(event.timestamp).toISOString()})</span>
          </MetaRow>
          <MetaRow label="Level">
            <Badge size="sm" tone={LEVEL_TONE[event.level]} variant="soft">
              {event.level}
            </Badge>
            {event.important && (
              <Badge size="sm" tone="warning" variant="outline" className="ml-1">
                important
              </Badge>
            )}
          </MetaRow>
          <MetaRow label="Sequence">#{event.seq}</MetaRow>
          <MetaRow label="ID">{event.id}</MetaRow>
          {event.tags.length > 0 && (
            <MetaRow label="Tags">
              <span className="flex flex-wrap gap-1">
                {event.tags.map((tag) => (
                  <Badge key={tag} size="sm" tone="neutral" variant="outline">
                    {tag}
                  </Badge>
                ))}
              </span>
            </MetaRow>
          )}
        </dl>

        <div className="mb-1 flex items-center gap-2">
          <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
            Payload
          </h3>
          {event.truncated && (
            <Badge size="sm" tone="warning" variant="soft">
              truncated
            </Badge>
          )}
          <div className="ml-auto flex gap-1">
            <Button
              size="sm"
              tone="neutral"
              variant="ghost"
              disabled={!hasPayload}
              onClick={() => void payloadCopy.copy(toPrettyJson(event.payload))}
            >
              {payloadCopy.copied ? <Check /> : <Copy />}
              Copy payload
            </Button>
            <Button
              size="sm"
              tone="neutral"
              variant="ghost"
              onClick={() => void eventCopy.copy(toPrettyJson(event))}
            >
              {eventCopy.copied ? <Check /> : <Copy />}
              Copy event
            </Button>
          </div>
        </div>

        {hasPayload ? (
          <div className="rounded-md border border-border bg-card p-2">
            <JsonInspector data={event.payload} defaultExpandedDepth={2} />
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">No payload.</p>
        )}
      </div>
    </section>
  );
}
