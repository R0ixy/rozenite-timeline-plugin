let warned = false;

/**
 * A timeline bug must never become an app bug: internal errors are caught at
 * every entry point and reported here, once per app run, then ignored.
 */
export const reportInternalError = (error: unknown) => {
  if (warned) {
    return;
  }
  warned = true;
  try {
    console.warn(
      '[rozenite-timeline-plugin] Internal error; the timeline may be incomplete. Further errors are ignored.',
      error,
    );
  } catch {
    // Nothing left to do.
  }
};
