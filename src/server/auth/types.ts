// Auth contract the app depends on. The managed provider (Neon Auth / Better Auth) sits behind it, so unit
// tests use a fake and make no network calls. The provider works on the ambient request: cookies are read and
// written by the adapter (Next.js server context), never handled by app code.

export interface AuthSession {
  userId: string;
  email: string;
}

export type SignInResult = { ok: true; session: AuthSession } | { ok: false };

export interface AuthProvider {
  /** The current request's session, or null when signed out. */
  getSession(): Promise<AuthSession | null>;
  /** Email + password sign-in. A failure never says which part was wrong. */
  signInWithPassword(email: string, password: string): Promise<SignInResult>;
  /** End the current session (clears the session cookie). Safe to call when signed out. */
  signOut(): Promise<void>;
}
