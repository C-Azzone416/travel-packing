export interface CloseAccountState {
  error: string | null;
  fieldErrors: { password?: string; confirmation?: string };
  /** App data is already fenced/deleted; offer the dedicated provider-deletion retry surface. */
  recovery?: true;
}

export const INITIAL_CLOSE_ACCOUNT_STATE: CloseAccountState = { error: null, fieldErrors: {} };
