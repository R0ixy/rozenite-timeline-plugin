import { timeline } from 'rozenite-timeline-plugin';

const flagsTimeline = timeline.channel('flags');
const remoteValues: Record<string, boolean> = { 'new-onboarding': true, 'dark-checkout': false };

/** A toy flag client that records every evaluation. */
export const getFlag = (key: string, fallback = false): boolean => {
  const source = key in remoteValues ? 'remote' : 'default';
  const value = remoteValues[key] ?? fallback;
  flagsTimeline.log({
    name: 'EVALUATE',
    preview: `${key} = ${String(value)}`,
    payload: { key, value, source },
    level: 'debug',
    tags: [source],
  });
  return value;
};
