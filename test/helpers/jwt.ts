// Access-style JWTs for tests: a fresh RSA key pair, a matching JWKS, and a signer that can also
// build the broken tokens a verifier must refuse. Nothing here touches the network.
import { createHmac, createSign, generateKeyPairSync, type KeyObject } from "node:crypto";

export const TEAM = "unit-team.cloudflareaccess.com";
export const AUD = "aud-tag-1";
export const OWNER = "Owner@Example.test";

export interface Pair {
  kid: string;
  privateKey: KeyObject;
  jwk: Record<string, unknown>;
}

export function makePair(kid = "k1"): Pair {
  const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  return {
    kid,
    privateKey,
    jwk: { ...publicKey.export({ format: "jwk" }), kid, alg: "RS256", use: "sig" },
  };
}

const enc = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");

export function claims(over: Record<string, unknown> = {}, now = Math.floor(Date.now() / 1000)) {
  return {
    iss: `https://${TEAM}`,
    aud: [AUD],
    email: OWNER.toLowerCase(),
    iat: now,
    nbf: now - 5,
    exp: now + 300,
    ...over,
  };
}

export function sign(
  pair: Pair,
  payload: Record<string, unknown> = claims(),
  header: Record<string, unknown> = { alg: "RS256", kid: pair.kid, typ: "JWT" },
): string {
  const input = `${enc(header)}.${enc(payload)}`;
  const sig = createSign("RSA-SHA256").update(input).sign(pair.privateKey).toString("base64url");
  return `${input}.${sig}`;
}

/** alg "none": header and payload, empty signature. */
export function unsigned(payload: Record<string, unknown> = claims()): string {
  return `${enc({ alg: "none", typ: "JWT" })}.${enc(payload)}.`;
}

/** The classic confusion attack: HS256 with the public key's own bytes as the secret. */
export function hs256(pair: Pair, payload: Record<string, unknown> = claims()): string {
  const input = `${enc({ alg: "HS256", kid: pair.kid, typ: "JWT" })}.${enc(payload)}`;
  const secret = JSON.stringify(pair.jwk);
  return `${input}.${createHmac("sha256", secret).update(input).digest("base64url")}`;
}
