export interface CloseAccountState {
  error: string | null;
  fieldErrors: { password?: string; confirmation?: string };
  /** App data is deleted behind a temporary fence; offer the dedicated provider-deletion retry surface. */
  recovery?: true;
  /**
   * The server still holds this account's feedback enrollment or a connection attempt (a second device or tab connected it, or the
   * page was stale). Nothing was authenticated or deleted; the sheet goes back to the Disconnect step (#261).
   */
  feedbackBlocking?: true;
}

export const INITIAL_CLOSE_ACCOUNT_STATE: CloseAccountState = { error: null, fieldErrors: {} };
