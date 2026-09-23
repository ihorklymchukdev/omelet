export type Account =
  | { state: "signed_out"; error: string | null }
  | { state: "pending"; user_code: string; url: string; expires_at: number }
  | {
      state: "signed_in";
      email: string | null;
      sync: { last_ok_at: number | null; last_error: string | null };
    };

// The link comes from the Omelet service; anything but https is refused, never repaired.
export function signInLink(url: string): string | null {
  try {
    return new URL(url).protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}

const REASONS: Record<string, string> = {
  access_denied: "The sign-in was turned down.",
  expired_token: "That code ran out before it was approved.",
  invalid_grant: "That code is no longer valid.",
  revoked: "This computer was signed out of your Omelet account.",
};

export function signInError(code: string | null): string | null {
  if (!code) return null;
  return REASONS[code] ?? "Sign-in didn't finish.";
}
