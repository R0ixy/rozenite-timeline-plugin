import {
  Badge,
  EmptyState,
  IndicatorDot,
  PluginShell,
  SearchField,
  Split,
  Toolbar,
  Trash2,
  useToast,
  VirtualizedList,
} from '@rozenite/ui';
import { Activity, Download, Pause, Play, Unplug } from 'lucide-react';
import { useCallback, useDeferredValue, useMemo, useState } from 'react';
import { filterEvents } from '../shared/filters';
import { TIMELINE_LEVELS, type TimelineEvent, type TimelineLevel } from '../shared/types';
import { EventDetail } from './event-detail';
import { EventRow } from './event-row';
import { FilterMenu } from './filter-menu';
import { buildExport, downloadText } from './format';
import { useTimeline, type TimelineConnectionStatus } from './use-timeline';
import './globals.css';

const SETUP_SNIPPET = `// App root, once:
useRozeniteTimelinePlugin();

// Anywhere:
timeline.log({ channel: 'analytics', name: 'EVENT', preview: 'checkout_started' });`;

const STATUS_LABEL: Record<TimelineConnectionStatus, string> = {
  waiting: 'Waiting for app',
  connected: 'Connected',
  disconnected: 'Disconnected',
};

const STATUS_TONE = {
  waiting: 'neutral',
  connected: 'success',
  disconnected: 'danger',
} as const;

const getEventKey = (event: TimelineEvent) => event.id;
const getEventText = (event: TimelineEvent) =>
  `${event.channel} ${event.name}${event.preview ? ` ${event.preview}` : ''}`;
// Pins the list to the newest row only while the user is already at the
// bottom, so scrolling up to read pauses auto-scroll.
const followOutput = (isAtBottom: boolean) => (isAtBottom ? ('auto' as const) : false);

function TimelinePanelContent() {
  const timeline = useTimeline();
  const toast = useToast();
  const [channels, setChannels] = useState<string[]>([]);
  const [levels, setLevels] = useState<TimelineLevel[]>([]);
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const deferredSearch = useDeferredValue(search);

  const visible = useMemo(
    () => filterEvents(timeline.events, { channels, levels, search: deferredSearch }),
    [timeline.events, channels, levels, deferredSearch],
  );
  const selected = useMemo(
    () => (selectedId ? (timeline.events.find((event) => event.id === selectedId) ?? null) : null),
    [timeline.events, selectedId],
  );
  const isFiltering = channels.length > 0 || levels.length > 0 || search.trim() !== '';

  const renderItem = useCallback(
    (event: TimelineEvent) => <EventRow event={event} selected={event.id === selectedId} />,
    [selectedId],
  );
  const handleItemClick = useCallback(
    (event: TimelineEvent) => setSelectedId((current) => (current === event.id ? null : event.id)),
    [],
  );

  const handleExport = () => {
    const json = buildExport(visible, { channels, levels, search });
    const fileName = `timeline-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    if (downloadText(fileName, json)) {
      toast.add({ title: `Exported ${visible.length} events`, type: 'success' });
      return;
    }
    void navigator.clipboard?.writeText(json).then(
      () =>
        toast.add({
          title: 'Download blocked — copied JSON to the clipboard instead',
          type: 'info',
        }),
      () => toast.add({ title: 'Could not export events', type: 'error' }),
    );
  };

  const handleClear = () => {
    timeline.clear();
    setSelectedId(null);
  };

  const toolbar = (
    <Toolbar aria-label="Timeline controls" className="flex-wrap">
      <div className="min-w-40 flex-1">
        <SearchField
          aria-label="Search events"
          placeholder="Search name, preview, payload…"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          onClear={() => setSearch('')}
        />
      </div>
      <Toolbar.Separator />
      <Toolbar.Group aria-label="Filters">
        <FilterMenu
          label="Channel"
          emptyLabel="No channels seen yet"
          options={timeline.channels}
          selected={channels}
          onChange={setChannels}
        />
        <FilterMenu label="Level" options={TIMELINE_LEVELS} selected={levels} onChange={setLevels} />
      </Toolbar.Group>
      <Toolbar.Separator />
      <Toolbar.Group aria-label="Actions">
        <Toolbar.Button
          onClick={() => timeline.setPaused(!timeline.paused)}
          aria-pressed={timeline.paused}
          className={timeline.paused ? 'bg-accent text-accent-foreground' : undefined}
        >
          {timeline.paused ? <Play /> : <Pause />}
          {timeline.paused ? 'Resume' : 'Pause'}
          {timeline.paused && timeline.held.length > 0 && (
            <Badge size="sm" tone="primary">
              +{timeline.held.length}
            </Badge>
          )}
        </Toolbar.Button>
        <Toolbar.Button onClick={handleClear} disabled={timeline.events.length === 0 && timeline.held.length === 0}>
          <Trash2 />
          Clear
        </Toolbar.Button>
        <Toolbar.Button onClick={handleExport} disabled={visible.length === 0}>
          <Download />
          Export
        </Toolbar.Button>
      </Toolbar.Group>
      <Toolbar.Separator />
      <span
        role="status"
        className="flex items-center gap-1.5 px-1 text-xs whitespace-nowrap text-muted-foreground"
      >
        <IndicatorDot tone={STATUS_TONE[timeline.status]} />
        {STATUS_LABEL[timeline.status]}
        <span aria-label="Event count">
          · {isFiltering ? `${visible.length} / ` : ''}
          {timeline.events.length}
        </span>
      </span>
    </Toolbar>
  );

  let body: React.ReactNode;
  if (timeline.status === 'waiting' && timeline.events.length === 0) {
    body = (
      <EmptyState
        icon={Unplug}
        title="Waiting for the app…"
        description="Make sure the app is running in development and calls useRozeniteTimelinePlugin() once at its root."
        action={
          <pre className="max-w-lg overflow-auto rounded-md border border-border bg-muted p-3 text-left font-mono text-xs text-foreground">
            {SETUP_SNIPPET}
          </pre>
        }
      />
    );
  } else if (timeline.events.length === 0) {
    body = (
      <EmptyState
        icon={Activity}
        title="No events yet"
        description={
          timeline.paused && timeline.held.length > 0
            ? `${timeline.held.length} events arrived while paused. Resume to show them.`
            : 'Events logged with timeline.log() appear here as they happen.'
        }
      />
    );
  } else {
    const list = (
      <VirtualizedList
        ariaLabel="Timeline events"
        data={visible}
        renderItem={renderItem}
        getItemKey={getEventKey}
        getItemTextValue={getEventText}
        onItemClick={handleItemClick}
        followOutput={followOutput}
        initialTopMostItemIndex={Math.max(visible.length - 1, 0)}
        emptyMessage="No events match your filters."
        style={{ height: '100%' }}
      />
    );

    body = selected ? (
      <Split direction="horizontal" autoSaveId="rozenite-timeline">
        <Split.Pane defaultSize={60} minSize={25}>
          {list}
        </Split.Pane>
        <Split.Handle />
        <Split.Pane defaultSize={40} minSize={20}>
          <EventDetail event={selected} onClose={() => setSelectedId(null)} />
        </Split.Pane>
      </Split>
    ) : (
      list
    );
  }

  return (
    <PluginShell.Body className="overflow-hidden">
      {toolbar}
      {timeline.status === 'disconnected' && (
        <div
          role="alert"
          className="flex items-center gap-2 border-b border-border bg-danger-soft px-3 py-1.5 text-xs text-danger"
        >
          <Unplug className="size-3.5" />
          The app stopped responding. Showing the last events received; the timeline resyncs when it
          reconnects.
        </div>
      )}
      <div className="min-h-0 flex-1">{body}</div>
    </PluginShell.Body>
  );
}

export default function TimelinePanel() {
  return (
    <PluginShell>
      <TimelinePanelContent />
    </PluginShell>
  );
}
