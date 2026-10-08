import type { JsonValue, TimelineEvent } from './types';

/** An event with its payload parsed back from JSON, for agents and exports. */
export type TimelineEventWithPayload = Omit<TimelineEvent, 'payloadJson'> & { payload?: JsonValue };

export const parsePayload = (event: TimelineEvent): JsonValue | undefined => {
  if (event.payloadJson === undefined) {
    return undefined;
  }
  try {
    return JSON.parse(event.payloadJson) as JsonValue;
  } catch {
    return event.payloadJson;
  }
};

export const withParsedPayload = ({ payloadJson, ...rest }: TimelineEvent): TimelineEventWithPayload =>
  payloadJson === undefined ? rest : { ...rest, payload: parsePayload({ ...rest, payloadJson }) };
