import { useRozenitePluginAgentTool } from '@rozenite/agent-bridge';
import { TIMELINE_AGENT_PLUGIN_ID, timelineToolDefinitions } from '../shared/agent-tools';
import { createTimelineAgentHandlers } from './agent-handlers';
import { getTimelineStore } from './timeline';

// The store is a process-wide singleton, so the handlers never need to change.
const handlers = createTimelineAgentHandlers(getTimelineStore);

export const useTimelineAgentTools = () => {
  useRozenitePluginAgentTool({
    pluginId: TIMELINE_AGENT_PLUGIN_ID,
    tool: timelineToolDefinitions.listEvents,
    handler: handlers.listEvents,
  });

  useRozenitePluginAgentTool({
    pluginId: TIMELINE_AGENT_PLUGIN_ID,
    tool: timelineToolDefinitions.getEvent,
    handler: handlers.getEvent,
  });

  useRozenitePluginAgentTool({
    pluginId: TIMELINE_AGENT_PLUGIN_ID,
    tool: timelineToolDefinitions.listChannels,
    handler: handlers.listChannels,
  });

  useRozenitePluginAgentTool({
    pluginId: TIMELINE_AGENT_PLUGIN_ID,
    tool: timelineToolDefinitions.clear,
    handler: handlers.clear,
  });
};
