export interface Session {
  userId: string;
  email: string;
  isDemo: boolean;
}

/**
 * Port for authentication. `DemoAuthAdapter` and `SupabaseAuthAdapter`
 * both implement this; route protection code (`getSessionOrRedirect`)
 * never branches on which one is active.
 */
export interface AuthPort {
  getSession(): Promise<Session | null>;
  signOut(): Promise<void>;
}
