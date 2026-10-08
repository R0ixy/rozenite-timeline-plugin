import { connectFakePair, RozeniteChannelProvider } from '@rozenite/testing';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { getTimelineStore, timeline } from '../react-native/timeline';
import { useRozeniteTimelinePlugin } from '../react-native/useRozeniteTimelinePlugin';
import TimelinePanel from '../ui/panel';

const DeviceHost = () => {
  useRozeniteTimelinePlugin();
  return null;
};

/** The real panel and the real device hook, wired over one in-memory channel. */
const renderPair = () => {
  const { device, panel } = connectFakePair();

  render(
    <>
      <RozeniteChannelProvider channel={device} role="device">
        <DeviceHost />
      </RozeniteChannelProvider>
      <RozeniteChannelProvider channel={panel} role="panel">
        <TimelinePanel />
      </RozeniteChannelProvider>
    </>,
  );
};

const rowNames = () =>
  screen.queryAllByTestId('timeline-row').map((row) => row.querySelector('.font-semibold')?.textContent);

/** Lets in-flight bridge messages land; used only to assert that something did NOT arrive. */
const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 80)));

describe('panel <-> app round trip', () => {
  beforeEach(() => {
    delete (globalThis as Record<string, unknown>).__ROZENITE_TIMELINE_STORE__;
  });

  it('shows buffered events, then live ones, with filters, details, pause and clear', async () => {
    timeline.log({ channel: 'analytics', name: 'EVENT', preview: 'checkout_started' });
    timeline.log({
      channel: 'flags',
      name: 'EVALUATE',
      preview: 'new-onboarding',
      payload: { key: 'new-onboarding', value: true, source: 'remote' },
      level: 'debug',
    });

    renderPair();

    // Buffered before anything connected: replayed through the snapshot.
    expect(await screen.findByText('checkout_started')).toBeTruthy();
    expect(screen.getByText('new-onboarding')).toBeTruthy();
    expect(screen.getByRole('status').textContent).toContain('Connected');

    // Live events stream in.
    act(() => {
      timeline.log({ channel: 'auth', name: 'LOGIN_FAILED', preview: 'bad password', level: 'error', important: true });
    });
    expect(await screen.findByText('bad password')).toBeTruthy();
    expect(rowNames()).toEqual(['EVENT', 'EVALUATE', 'LOGIN_FAILED']);
    expect(screen.getAllByTestId('timeline-row')[2].dataset.important).toBe('true');

    // Free-text search reaches into the payload.
    fireEvent.change(screen.getByLabelText('Search events'), { target: { value: 'remote' } });
    expect(await screen.findByText('new-onboarding')).toBeTruthy();
    expect(rowNames()).toEqual(['EVALUATE']);
    fireEvent.change(screen.getByLabelText('Search events'), { target: { value: '' } });

    // Selecting a row opens the detail pane with the payload tree.
    fireEvent.click(screen.getByText('new-onboarding'));
    const details = await screen.findByRole('region', { name: 'Event details' });
    expect(within(details).getByText('"remote"')).toBeTruthy();
    fireEvent.click(within(details).getByRole('button', { name: 'Close details' }));

    // Pausing holds new events back until resume.
    fireEvent.click(screen.getByRole('button', { name: /Pause/ }));
    act(() => {
      timeline.log({ channel: 'analytics', name: 'SCREEN', preview: 'Home' });
    });
    await settle();
    expect(screen.queryByText('Home')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Resume/ }));
    expect(await screen.findByText('Home')).toBeTruthy();

    // Clear empties the panel and the app buffer.
    fireEvent.click(screen.getByRole('button', { name: /Clear/ }));
    expect(await screen.findByText('No events yet')).toBeTruthy();
    await settle();
    expect(getTimelineStore().size).toBe(0);
  });

  it('shows the waiting state while no app answers', async () => {
    const { panel } = connectFakePair();

    render(
      <RozeniteChannelProvider channel={panel} role="panel">
        <TimelinePanel />
      </RozeniteChannelProvider>,
    );

    expect(await screen.findByText('Waiting for the app…')).toBeTruthy();
  });
});
