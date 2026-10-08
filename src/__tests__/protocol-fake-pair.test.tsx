import { getRozeniteDevToolsClient, type RozeniteDevToolsClient } from '@rozenite/plugin-bridge';
import { connectFakePair, RozeniteChannelProvider, waitForMessage } from '@rozenite/testing';
import { render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TIMELINE_PLUGIN_ID, type TimelineEventMap } from '../shared/messaging';
import { getTimelineStore, timeline } from '../react-native/timeline';
import { useRozeniteTimelinePlugin } from '../react-native/useRozeniteTimelinePlugin';

const TIMEOUT = { timeoutMs: 1000 };

const DeviceHost = ({ maxEvents }: { maxEvents?: number }) => {
  useRozeniteTimelinePlugin({ maxEvents });
  return null;
};

const setup = async (maxEvents?: number) => {
  const { device, panel } = connectFakePair();
  const panelClient: RozeniteDevToolsClient<TimelineEventMap> =
    await getRozeniteDevToolsClient<TimelineEventMap>(TIMELINE_PLUGIN_ID, { channel: panel });
  const deviceReady = waitForMessage(panelClient, 'device-ready', TIMEOUT);

  const view = render(
    <RozeniteChannelProvider channel={device} role="device">
      <DeviceHost maxEvents={maxEvents} />
    </RozeniteChannelProvider>,
  );
  await deviceReady;

  const setMaxEvents = (next: number) =>
    view.rerender(
      <RozeniteChannelProvider channel={device} role="device">
        <DeviceHost maxEvents={next} />
      </RozeniteChannelProvider>,
    );

  return { panelClient, view, setMaxEvents };
};

describe('timeline protocol (device hook <-> panel client)', () => {
  beforeEach(() => {
    delete (globalThis as Record<string, unknown>).__ROZENITE_TIMELINE_STORE__;
  });

  afterEach(() => {
    getTimelineStore().detach();
  });

  it('replays events logged before the hook mounted, then streams new ones', async () => {
    timeline.log({ channel: 'analytics', name: 'EVENT', preview: 'app_open' });
    timeline.channel('auth').log({ name: 'RESTORE', payload: { userId: 'u1' } });

    const { panelClient } = await setup();

    const snapshot = waitForMessage(panelClient, 'snapshot', TIMEOUT);
    panelClient.send('hello', {});
    const { events, maxEvents } = await snapshot;

    expect(maxEvents).toBe(1000);
    expect(events.map((event) => [event.channel, event.name])).toEqual([
      ['analytics', 'EVENT'],
      ['auth', 'RESTORE'],
    ]);
    expect(events[1].payloadJson).toBe('{"userId":"u1"}');

    // Each event goes out on its own, in the log() call.
    const received: string[] = [];
    const subscription = panelClient.onMessage('events', ({ events: batch }) =>
      batch.forEach((event) => received.push(event.payloadJson ?? '')),
    );
    const second = waitForMessage(panelClient, 'events', TIMEOUT, ({ events: batch }) =>
      batch.some((event) => event.payloadJson?.includes('gamma') ?? false),
    );
    timeline.log({ channel: 'flags', name: 'EVALUATE', payload: { key: 'beta', value: true } });
    timeline.log({ channel: 'flags', name: 'EVALUATE', payload: { key: 'gamma', value: false } });
    await second;
    subscription.remove();

    expect(received).toEqual(['{"key":"beta","value":true}', '{"key":"gamma","value":false}']);

    panelClient.close();
  });

  it('replays the whole buffer when the panel reconnects', async () => {
    const { panelClient } = await setup();
    timeline.log({ channel: 'c', name: 'ONE' });

    const first = waitForMessage(panelClient, 'snapshot', TIMEOUT);
    panelClient.send('hello', {});
    await first;

    timeline.log({ channel: 'c', name: 'TWO' });

    // A reloaded panel says hello again and gets everything, not just the tail.
    const second = waitForMessage(panelClient, 'snapshot', TIMEOUT);
    panelClient.send('hello', {});
    expect((await second).events.map((event) => event.name)).toEqual(['ONE', 'TWO']);

    panelClient.close();
  });

  it('honours maxEvents', async () => {
    for (let index = 0; index < 5; index += 1) {
      timeline.log({ channel: 'c', name: `E${index}` });
    }
    const { panelClient } = await setup(3);

    const snapshot = waitForMessage(panelClient, 'snapshot', TIMEOUT);
    panelClient.send('hello', {});
    const { events, maxEvents } = await snapshot;

    expect(maxEvents).toBe(3);
    expect(events.map((event) => event.name)).toEqual(['E2', 'E3', 'E4']);

    panelClient.close();
  });

  it('clears the app buffer when the panel asks, and tells the panel when the app clears', async () => {
    const { panelClient } = await setup();
    timeline.log({ channel: 'c', name: 'E' });
    const snapshot = waitForMessage(panelClient, 'snapshot', TIMEOUT);
    panelClient.send('hello', {});
    await snapshot;

    const clearedByPanel = waitForMessage(panelClient, 'cleared', TIMEOUT);
    panelClient.send('clear', {});
    await clearedByPanel;
    expect(getTimelineStore().size).toBe(0);

    timeline.log({ channel: 'c', name: 'E2' });
    const clearedByApp = waitForMessage(panelClient, 'cleared', TIMEOUT);
    timeline.clear();
    await clearedByApp;

    panelClient.close();
  });

  it('stops streaming after bye', async () => {
    const { panelClient } = await setup();
    const snapshot = waitForMessage(panelClient, 'snapshot', TIMEOUT);
    panelClient.send('hello', {});
    await snapshot;
    expect(getTimelineStore().isAttached).toBe(true);

    panelClient.send('bye', {});
    await vi.waitFor(() => expect(getTimelineStore().isAttached).toBe(false), { timeout: 1000 });

    panelClient.close();
  });

  it('stops streaming when the hook unmounts', async () => {
    const { panelClient, view } = await setup();
    const snapshot = waitForMessage(panelClient, 'snapshot', TIMEOUT);
    panelClient.send('hello', {});
    await snapshot;

    view.unmount();

    expect(getTimelineStore().isAttached).toBe(false);
    panelClient.close();
  });

  it('registers the agent tools under the plugin domain while mounted', async () => {
    const tools = (globalThis as Record<string, unknown>).__registeredAgentTools as Map<
      string,
      { handler: (args: unknown) => unknown }
    >;
    const { panelClient, view } = await setup();
    timeline.log({ channel: 'analytics', name: 'EVENT' });

    expect([...tools.keys()].sort()).toEqual([
      `${TIMELINE_PLUGIN_ID}.clear`,
      `${TIMELINE_PLUGIN_ID}.get-event`,
      `${TIMELINE_PLUGIN_ID}.list-channels`,
      `${TIMELINE_PLUGIN_ID}.list-events`,
    ]);
    expect(await tools.get(`${TIMELINE_PLUGIN_ID}.list-channels`)!.handler({})).toMatchObject({
      totalEvents: 1,
    });

    view.unmount();
    expect(tools.size).toBe(0);
    panelClient.close();
  });

  it('tells an open panel when maxEvents changes', async () => {
    const { panelClient, setMaxEvents } = await setup(100);

    const announced = waitForMessage(panelClient, 'device-ready', TIMEOUT);
    setMaxEvents(250);

    expect(await announced).toEqual({ maxEvents: 250 });
    expect(getTimelineStore().maxEvents).toBe(250);
    panelClient.close();
  });
});

