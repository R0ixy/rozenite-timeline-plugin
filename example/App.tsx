import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { timeline, useRozeniteTimelinePlugin } from 'rozenite-timeline-plugin';
import { analytics } from './src/analytics';
import { getFlag } from './src/flags';

// Logged at module load, long before DevTools connects: buffered and replayed.
timeline.log({ channel: 'app', name: 'BOOT', preview: 'JS bundle evaluated' });

const authTimeline = timeline.channel('auth');

type Action = { label: string; run: () => void };

const ACTIONS: Action[] = [
  {
    label: 'Track checkout_started',
    run: () => analytics.track('checkout_started', { cartId: 'c_42', items: 3, total: 59.9 }),
  },
  { label: 'Screen: Product', run: () => analytics.screen('Product', { sku: 'SKU-1' }) },
  {
    label: 'Identify user',
    run: () => analytics.identify('user_123', { plan: 'pro', signedUpAt: new Date() }),
  },
  { label: 'Evaluate flags', run: () => [getFlag('new-onboarding'), getFlag('beta-search')] },
  {
    label: 'Auth: token refresh failed',
    run: () =>
      authTimeline.log({
        name: 'REFRESH_FAILED',
        preview: '401 from /oauth/token',
        level: 'error',
        important: true,
        payload: { error: new Error('Unauthorized'), attempt: 2 },
      }),
  },
  {
    label: 'Log a nasty payload',
    run: () => {
      const cyclic: Record<string, unknown> = {
        map: new Map([['a', 1]]),
        set: new Set(['x']),
        big: 10n ** 20n,
        fn: function handler() {},
        blob: 'x'.repeat(200_000),
      };
      cyclic.self = cyclic;
      timeline.log({ channel: 'debug', name: 'STRESS', preview: 'cycles, Map, BigInt, 200 KB', payload: cyclic, level: 'warn' });
    },
  },
  {
    label: 'Burst of 500 events',
    run: () => {
      for (let index = 0; index < 500; index += 1) {
        timeline.log({ channel: 'perf', name: 'TICK', preview: `tick ${index}`, payload: { index }, level: 'debug' });
      }
    },
  },
  { label: 'Clear timeline', run: () => timeline.clear() },
];

export default function App() {
  useRozeniteTimelinePlugin({ maxEvents: 2000 });
  const [count, setCount] = useState(0);

  useEffect(() => {
    analytics.screen('Home');
    authTimeline.log({ name: 'SESSION_RESTORED', preview: 'user_123', payload: { expiresIn: 3600 } });
  }, []);

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Timeline playground</Text>
      <Text style={styles.subtitle}>
        Open React Native DevTools → Timeline. Actions run: {count}
      </Text>
      <ScrollView contentContainerStyle={styles.list}>
        {ACTIONS.map((action) => (
          <Pressable
            key={action.label}
            accessibilityRole="button"
            style={({ pressed }) => [styles.button, pressed && styles.pressed]}
            onPress={() => {
              action.run();
              setCount((current) => current + 1);
            }}
          >
            <Text style={styles.buttonText}>{action.label}</Text>
          </Pressable>
        ))}
      </ScrollView>
      <StatusBar style="auto" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff', paddingTop: 80, paddingHorizontal: 20 },
  title: { fontSize: 24, fontWeight: '700' },
  subtitle: { marginTop: 4, marginBottom: 16, color: '#666' },
  list: { gap: 10, paddingBottom: 40 },
  button: { backgroundColor: '#8232FF', borderRadius: 10, paddingVertical: 14, paddingHorizontal: 16 },
  pressed: { opacity: 0.7 },
  buttonText: { color: '#fff', fontWeight: '600' },
});
