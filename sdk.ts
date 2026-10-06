import { defineAgentToolDescriptors } from '@rozenite/agent-shared';
import { TIMELINE_AGENT_PLUGIN_ID, timelineToolDefinitions } from './src/shared/agent-tools.js';

export { TIMELINE_AGENT_PLUGIN_ID, timelineToolDefinitions };

/** Typed descriptors for `@rozenite/agent-sdk`: `session.tools.call(timelineTools.listEvents, …)`. */
export const timelineTools = defineAgentToolDescriptors(
  TIMELINE_AGENT_PLUGIN_ID,
  timelineToolDefinitions,
);

export type {
  TimelineClearArgs,
  TimelineClearResult,
  TimelineGetEventArgs,
  TimelineGetEventResult,
  TimelineListChannelsArgs,
  TimelineListChannelsResult,
  TimelineListEventsArgs,
  TimelineListEventsResult,
} from './src/shared/agent-tools.js';

export type { TimelineEvent, TimelineLevel } from './src/shared/types';
