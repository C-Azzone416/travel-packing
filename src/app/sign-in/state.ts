// Shared by the sign-in server action and its form. Not in actions.ts because a "use server" module may only
// export async functions.

export interface SignInState {
  error: string | null;
}

export const INVALID_CREDENTIALS_MESSAGE = "Email or password is incorrect.";
export const UNAVAILABLE_MESSAGE = "Sign-in isn't available right now.";
export const RATE_LIMITED_MESSAGE = "Too many sign-in attempts. Wait a few minutes and try again.";
