// The pages a signed-out visitor may see. One list, shared by the request gate and the post-deploy smoke test, so a
// public auth page is covered by the smoke test the moment the gate lets visitors in.

export const SIGN_IN_PATH = "/sign-in";
export const ACCESS_DENIED_PATH = "/access-denied";
export const SIGN_UP_PATH = "/sign-up";
export const VERIFY_PATH = "/verify";
export const FORGOT_PASSWORD_PATH = "/forgot-password";
export const RESET_PASSWORD_PATH = "/reset-password";
export const FINISH_SETUP_PATH = "/finish-setup";

/** Everything else is protected. */
export const PUBLIC_PATHS: readonly string[] = [
  SIGN_IN_PATH,
  ACCESS_DENIED_PATH,
  SIGN_UP_PATH,
  VERIFY_PATH,
  FORGOT_PASSWORD_PATH,
  RESET_PASSWORD_PATH,
  FINISH_SETUP_PATH,
];
