/**
 * Feature-independent integration seam. Framebriar may implement local outbox cleanup here later, without changing the
 * server deletion transaction. This is called only after the one-time confirmed-deletion signal has been consumed.
 */
export const runConfirmedAccountClosureClientCleanup = (): Promise<void> => Promise.resolve();
