// The pages a signed-out visitor may see. One list, shared by the request gate and the post-deploy smoke test, so a
// public auth page added later (sign-up, #27) is covered by the smoke test the moment the gate lets visitors in.

export const SIGN_IN_PATH = "/sign-in";
export const ACCESS_DENIED_PATH = "/access-denied";

/** Everything else is protected. */
export const PUBLIC_PATHS: readonly string[] = [SIGN_IN_PATH, ACCESS_DENIED_PATH];
