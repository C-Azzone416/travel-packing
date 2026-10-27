// Every sentence the account screens show, in one place. None of it says whether an address has an account or is allowed
// in: that is the contract of #27, and keeping the words together makes it easy to check.

import {
  CODE_LENGTH,
  CODE_LIFETIME_MINUTES,
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
  RESET_LIFETIME_HOURS,
  type PasswordProblem,
} from "@/server/auth/account-flows";
import { RESEND_COOLDOWN_SECONDS } from "@/server/auth/flow-limits";

export const INVALID_EMAIL = "Enter a valid email address.";
export const MISSING_CODE = `Enter the ${CODE_LENGTH}-digit code.`;
export const WRONG_CODE = "That code isn't right or has expired. Check it, or send a new code.";
export const LOCKED_CODE = "Too many attempts. Send a new code to try again.";
export const TOO_MANY_REQUESTS = "Too many requests. Try again in a few minutes.";
export const UNAVAILABLE = "Something went wrong on our side. Try again in a moment.";
export const PASSWORD_RULE = `At least ${MIN_PASSWORD_LENGTH} characters.`;
export const PASSWORD_UPDATED = "Password updated. Sign in with your new password.";
export const EMAIL_CONFIRMED = "Email confirmed. Sign in to continue.";

export function passwordError(problem: PasswordProblem | "provider"): string {
  if (problem === "missing") return "Enter a password.";
  if (problem === "too-long") return `Password must be ${MAX_PASSWORD_LENGTH} characters or fewer.`;
  return `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
}

export const verifyHelper = (email: string) =>
  `If ${email} can be used to sign up, we've sent it a ${CODE_LENGTH}-digit code. It expires in ${CODE_LIFETIME_MINUTES} minutes.`;
export const forgotSentHelper = (email: string) =>
  `If there's an account for ${email}, we've sent a link to reset your password. It expires in ${RESET_LIFETIME_HOURS} hour.`;

/** After a right sign-up code, or a sign-in with the right password before it was set through a link (#83). */
export const FINISH_SETUP_TITLE = "Check your email to finish setting up";
export const finishSetupHelper = (email: string | null) =>
  email
    ? `We've sent a link to ${email}. Open it to choose your password. It expires in ${RESET_LIFETIME_HOURS} hour.`
    : "Open the link we emailed to choose your password. If you can't find it, we can send another.";
export const PASSWORD_SET = "Password set. Sign in with your new password.";
export const ACCOUNT_CLOSED =
  "Your account identity and Packed Smart trips, lists, and preferences were permanently deleted.";
/** Added under the one generic sign-in error, the same for every address (so it says nothing about any account). */
export const SIGN_IN_HINT_BEFORE =
  "If you just signed up, check your email for a link to finish setting up, or ";

/** The resend control's words for a code ("verify") and for a link ("reset"). */
export const RESEND_COPY = {
  verify: {
    button: "Send a new code",
    wait: (seconds: number) => `You can request another code in ${seconds}s`,
    sent: `New code sent. You can request another in ${RESEND_COOLDOWN_SECONDS} seconds.`,
    ready: "You can request a new code now.",
  },
  setup: {
    button: "Send the link again",
    wait: (seconds: number) => `You can request another link in ${seconds}s`,
    sent: `Link sent again. You can request another in ${RESEND_COOLDOWN_SECONDS} seconds.`,
    ready: "You can request a new link now.",
  },
  reset: {
    button: "Send it again",
    wait: (seconds: number) => `You can send it again in ${seconds}s`,
    sent: `Reset link sent again. You can send it again in ${RESEND_COOLDOWN_SECONDS} seconds.`,
    ready: "You can send it again now.",
  },
} as const;

/**
 * The "Didn't get it?" note under the resend control (#119, design on the issue). One wording on all three screens and for
 * every address; it never says whether a mail was sent. {host} is only given on the Preview.
 */
export const DIDNT_GET_IT = {
  summary: "Didn’t get it?",
  lines: (host: string | null): string[] => [
    "It can take a couple of minutes. You can ask for another in a moment.",
    "Check your spam or junk folder.",
    host
      ? `Open the link from the same web address you started on (${host}). A link opened from a different web address won’t work.`
      : "Open the link from the same web address you normally use for this app. A link opened from a different web address won’t work.",
  ],
} as const;
