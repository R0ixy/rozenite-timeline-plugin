import { useRozenitePluginAgentTool } from '@rozenite/agent-bridge';
import type {
  TimelineGetEventArgs,
  TimelineGetEventResult,
  TimelineListEventsArgs,
  TimelineListEventsResult,
} from '../shared/agent-tools';
import { timelineToolDefinitions } from '../shared/agent-tools';
import { TIMELINE_PLUGIN_ID } from '../shared/messaging';
import { createTimelineAgentHandlers } from './agent-handlers';
import { getTimelineStore } from './timeline';

// The store is a process-wide singleton, so the handlers never need to change.
const handlers = createTimelineAgentHandlers(getTimelineStore);

export const useTimelineAgentTools = () => {
  useRozenitePluginAgentTool<TimelineListEventsArgs, TimelineListEventsResult>({
    pluginId: TIMELINE_PLUGIN_ID,
    tool: timelineToolDefinitions.listEvents,
    handler: handlers.listEvents,
  });

  useRozenitePluginAgentTool<TimelineGetEventArgs, TimelineGetEventResult>({
    pluginId: TIMELINE_PLUGIN_ID,
    tool: timelineToolDefinitions.getEvent,
    handler: handlers.getEvent,
  });

  useRozenitePluginAgentTool({
    pluginId: TIMELINE_PLUGIN_ID,
    tool: timelineToolDefinitions.listChannels,
    handler: handlers.listChannels,
  });

  useRozenitePluginAgentTool({
    pluginId: TIMELINE_PLUGIN_ID,
    tool: timelineToolDefinitions.clear,
    handler: handlers.clear,
  });
};
