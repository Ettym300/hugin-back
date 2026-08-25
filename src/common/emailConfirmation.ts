import env from './env';

/**
 * Email confirmation is off for local Rugin testing (no SMTP).
 * Set EMAIL_CONFIRMATION_ENABLED=true to turn the gate back on.
 */
export function isEmailConfirmed(emailConfirmed?: boolean | null) {
  if (!env.EMAIL_CONFIRMATION_ENABLED) return true;
  return !!emailConfirmed;
}
