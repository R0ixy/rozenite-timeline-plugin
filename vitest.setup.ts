import * as React from 'react';
import { afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';

afterEach(() => {
  cleanup();
});

type MockVirtuosoProps = {
  data?: unknown[];
  itemContent: (index: number, item: unknown) => React.ReactNode;
  computeItemKey?: (index: number, item: unknown) => string;
  components?: Record<string, React.ComponentType<any>>;
  context?: unknown;
  className?: string;
};

// `react-virtuoso` renders no rows in jsdom: it never gets a real layout to
// measure. Swap in a non-virtualized passthrough that still goes through the
// `List` / `Item` components `@rozenite/ui` hands it, so row clicks and
// accessible labels behave as in the browser.
vi.mock('react-virtuoso', () => ({
  Virtuoso: ({ data = [], itemContent, computeItemKey, components = {}, context, className }: MockVirtuosoProps) => {
    const { List = 'div', Item = 'div', EmptyPlaceholder } = components;
    if (data.length === 0 && EmptyPlaceholder) {
      return React.createElement(EmptyPlaceholder, { context });
    }
    return React.createElement(
      'div',
      { className, 'data-testid': 'virtuoso-mock' },
      React.createElement(
        List,
        { context },
        data.map((item, index) =>
          React.createElement(
            Item,
            {
              key: computeItemKey?.(index, item) ?? index,
              item,
              context,
              'data-index': index,
              'data-item-index': index,
            },
            itemContent(index, item),
          ),
        ),
      ),
    );
  },
}));

/** Agent tools registered through `useRozenitePluginAgentTool`, by qualified name. */
const registeredAgentTools = new Map<string, { handler: (args: unknown) => unknown }>();
(globalThis as Record<string, unknown>).__registeredAgentTools = registeredAgentTools;

vi.mock('@rozenite/agent-bridge', () => ({
  useRozenitePluginAgentTool: ({
    pluginId,
    tool,
    handler,
  }: {
    pluginId: string;
    tool: { name: string };
    handler: (args: unknown) => unknown;
  }) => {
    React.useEffect(() => {
      const name = `${pluginId}.${tool.name}`;
      registeredAgentTools.set(name, { handler });
      return () => {
        registeredAgentTools.delete(name);
      };
    }, [pluginId, tool, handler]);
  },
}));

// jsdom has no ResizeObserver; the Split pane (react-resizable-panels) needs one.
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}
