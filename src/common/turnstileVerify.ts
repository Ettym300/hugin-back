import env from './env';

interface TurnstileResponse {
  success: boolean;
  'error-codes'?: string[];
  challenge_ts?: string;
  hostname?: string;
}

function allowedTurnstileHostnames(): string[] {
  const hosts = new Set<string>(['rugin.com', 'www.rugin.com']);
  if (env.CLIENT_URL) {
    try {
      hosts.add(new URL(env.CLIENT_URL).hostname);
    } catch {
      /* ignore invalid CLIENT_URL */
    }
  }
  return [...hosts];
}

export async function turnstileVerify(token: string, remoteIp?: string): Promise<boolean> {
  // Match frontend: no widget when DEV_MODE or Turnstile is not configured.
  if (env.DEV_MODE || !env.TURNSTILE_SECRET) return true;

  const params = new URLSearchParams();
  params.append('secret', env.TURNSTILE_SECRET);
  params.append('response', token);
  if (remoteIp) {
    params.append('remoteip', remoteIp);
  }

  try {
    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      body: params,
    });

    if (!res.ok) {
      return false;
    }

    const json = (await res.json()) as TurnstileResponse;

    if (json.hostname && !allowedTurnstileHostnames().includes(json.hostname)) {
      return false;
    }

    if (json.challenge_ts) {
      const challengeDate = new Date(json.challenge_ts).getTime();
      const now = Date.now();
      const fiveMinutes = 5 * 60 * 1000;

      if (now - challengeDate > fiveMinutes) {
        return false;
      }
    }

    return json.success;
  } catch {
    return false;
  }
}
