/**
 * Owner check for hosted mode: verifies the Cf-Access-Jwt-Assertion header with node:crypto.
 *   - RS256 only; every other alg (none, HS256, ...) is refused before any key is touched
 *   - keys come from https://<team>.cloudflareaccess.com/cdn-cgi/access/certs, cached, refetched once
 *     when a token names a key id we don't have (rate-limited)
 *   - iss is the team domain, aud contains the application's tag, exp and nbf are checked with leeway
 *   - the email claim must be the owner's (case-insensitive); a service-token JWT has none
 * A failure returns a short code for the log; the token itself is never logged or returned.
 */
import { createPublicKey, verify as rsaVerify, type KeyObject } from "node:crypto";

export type Refusal =
  | "missing-token"
  | "malformed"
  | "bad-alg"
  | "unknown-key"
  | "jwks-unavailable"
  | "bad-signature"
  | "bad-issuer"
  | "bad-audience"
  | "expired"
  | "not-yet-valid"
  | "no-email"
  | "not-owner";

export type Verdict = { ok: true; email: string } | { ok: false; reason: Refusal };

export interface AccessVerifierOptions {
  /** <team>.cloudflareaccess.com */
  teamDomain: string;
  aud: string;
  ownerEmail: string;
  /** Returns the parsed JWKS document. Default: fetch the team's certs URL. */
  fetchJwks?: (url: string) => Promise<unknown>;
  /** Seconds since the epoch. */
  now?: () => number;
  leewaySeconds?: number;
  /** How long a fetched key set is trusted. */
  cacheSeconds?: number;
  /** Least time between two fetches, even for an unknown key id. */
  minRefetchSeconds?: number;
}

const MAX_TOKEN = 16 * 1024;
const b64 = (s: string) => Buffer.from(s, "base64url");

function json(part: string): Record<string, unknown> | null {
  try {
    const v = JSON.parse(b64(part).toString("utf8"));
    return v && typeof v === "object" && !Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
}

async function defaultFetchJwks(url: string): Promise<unknown> {
  const r = await fetch(url, { signal: AbortSignal.timeout(5000) });
  if (!r.ok) throw new Error(`certs answered ${r.status}`);
  return r.json();
}

export function createAccessVerifier(o: AccessVerifierOptions) {
  const certsUrl = `https://${o.teamDomain}/cdn-cgi/access/certs`;
  const issuer = `https://${o.teamDomain}`;
  const owner = o.ownerEmail.trim().toLowerCase();
  const leeway = o.leewaySeconds ?? 30;
  const cacheFor = o.cacheSeconds ?? 600;
  const minRefetch = o.minRefetchSeconds ?? 30;
  const now = o.now ?? (() => Math.floor(Date.now() / 1000));
  const getJwks = o.fetchJwks ?? defaultFetchJwks;

  let keys = new Map<string, KeyObject>();
  let fetchedAt = -Infinity;
  let lastAttempt = -Infinity;
  let inflight: Promise<void> | undefined;

  function refresh(): Promise<void> {
    inflight ??= (async () => {
      lastAttempt = now();
      try {
        const doc = (await getJwks(certsUrl)) as { keys?: unknown };
        const next = new Map<string, KeyObject>();
        for (const jwk of Array.isArray(doc?.keys) ? doc.keys : []) {
          const k = jwk as Record<string, unknown>;
          if (k?.kty !== "RSA" || typeof k.kid !== "string") continue;
          if (k.alg !== undefined && k.alg !== "RS256") continue;
          if (k.use !== undefined && k.use !== "sig") continue;
          try {
            const key = createPublicKey({ key: k as never, format: "jwk" });
            if ((key.asymmetricKeyDetails?.modulusLength ?? 0) < 2048) continue;
            next.set(k.kid, key);
          } catch {
            /* skip an unusable key */
          }
        }
        keys = next;
        fetchedAt = now();
      } finally {
        inflight = undefined;
      }
    })();
    return inflight;
  }

  async function keyFor(kid: string): Promise<KeyObject | Refusal> {
    try {
      const mayFetch = () => now() - lastAttempt >= minRefetch;
      if (now() - fetchedAt >= cacheFor && mayFetch()) await refresh().catch(() => {});
      let k = keys.get(kid);
      if (!k && mayFetch()) {
        await refresh();
        k = keys.get(kid);
      }
      if (k) return k;
      return keys.size === 0 && fetchedAt === -Infinity ? "jwks-unavailable" : "unknown-key";
    } catch {
      return "jwks-unavailable";
    }
  }

  return async function verify(token: string | undefined): Promise<Verdict> {
    const no = (reason: Refusal): Verdict => ({ ok: false, reason });
    if (!token) return no("missing-token");
    if (token.length > MAX_TOKEN) return no("malformed");
    const parts = token.split(".");
    // The signature may be empty (alg none) so that the alg check, not this one, refuses it.
    const [h, c, sig] = parts;
    const b64url = /^[A-Za-z0-9_-]*$/;
    if (parts.length !== 3 || !h || !c || ![h, c, sig].every((p) => b64url.test(p)))
      return no("malformed");
    const header = json(h);
    const claims = json(c);
    if (!header || !claims) return no("malformed");
    if (header.alg !== "RS256") return no("bad-alg");
    if (typeof header.kid !== "string") return no("unknown-key");

    const key = await keyFor(header.kid);
    if (typeof key === "string") return no(key);
    const good = rsaVerify("sha256", Buffer.from(`${parts[0]}.${parts[1]}`), key, b64(parts[2]));
    if (!good) return no("bad-signature");

    if (claims.iss !== issuer) return no("bad-issuer");
    const aud = claims.aud;
    if (!(typeof aud === "string" ? aud === o.aud : Array.isArray(aud) && aud.includes(o.aud)))
      return no("bad-audience");
    const t = now();
    if (typeof claims.exp !== "number" || t > claims.exp + leeway) return no("expired");
    if (claims.nbf !== undefined && (typeof claims.nbf !== "number" || t < claims.nbf - leeway))
      return no("not-yet-valid");
    if (typeof claims.email !== "string" || !claims.email) return no("no-email");
    if (claims.email.trim().toLowerCase() !== owner) return no("not-owner");
    return { ok: true, email: claims.email };
  };
}
