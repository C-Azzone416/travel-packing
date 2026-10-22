// The shapes the account actions and forms share. Not in an actions.ts file because a "use server" module may only export
// async functions.

export interface FormState {
  /** A form-level problem, shown once in the alert above the button. */
  error: string | null;
  /** Problems with one field each, shown under that field. */
  fieldErrors: { email?: string; password?: string; code?: string };
  /** What the person typed, handed back because React clears the form after an action. */
  email: string;
  /** The code that was just refused, kept in the box (selected) so a near-miss can be corrected rather than retyped. */
  code?: string;
}

export const INITIAL_FORM: FormState = { error: null, fieldErrors: {}, email: "" };

export interface ResendState {
  /** Changes on every answer so the form can tell a new answer from the one it already announced. */
  nonce: number;
  status: "idle" | "sent" | "cooldown" | "limited" | "error";
  /** Seconds until another send is allowed (0 = now). */
  cooldownSeconds: number;
}

export const INITIAL_RESEND: ResendState = { nonce: 0, status: "idle", cooldownSeconds: 0 };

export interface ForgotState extends FormState {
  /** Set once the request is made, whatever the address: the form is replaced by "Check your email". */
  sent: { email: string; cooldownSeconds: number } | null;
}

export const INITIAL_FORGOT: ForgotState = { ...INITIAL_FORM, sent: null };
