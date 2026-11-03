// Sign-in with Microsoft Entra ID. The API accepts an Entra access token, checks its signature, issuer,
// audience and lifetime, and turns it into a Principal: the person (looked up by object id), their app roles
// and their employing entity. Locally and in tests a dev issuer signs tokens of the same shape, so the same
// verification code runs everywhere; the API refuses to start with it in production.
import { platformConfig, substituteEnv } from "@rop/platform";
import {
  createLocalJWKSet,
  createRemoteJWKSet,
  exportJWK,
  generateKeyPair,
  type JSONWebKeySet,
  type JWTPayload,
  type JWTVerifyGetKey,
  jwtVerify,
  SignJWT,
} from "jose";

export interface TokenClaims {
  oid: string;
  tid?: string;
  roles: string[];
  /** "app" for an application (managed identity) token, "user" for a person */
  idtyp: "app" | "user";
  name?: string;
}

export interface Verifier {
  readonly issuer: string;
  readonly audience: string;
  verify(token: string): Promise<TokenClaims>;
}

export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthError";
  }
}

function claimsOf(payload: JWTPayload): TokenClaims {
  const oid = payload.oid;
  if (typeof oid !== "string" || !/^[0-9a-f-]{36}$/i.test(oid))
    throw new AuthError("token has no object id (oid)");
  const roles = Array.isArray(payload.roles)
    ? payload.roles.filter((r): r is string => typeof r === "string")
    : [];
  // Entra sets idtyp=app on app-only tokens when the optional claim is configured (infra/ does that).
  const idtyp = payload.idtyp === "app" ? "app" : "user";
  return {
    oid: oid.toLowerCase(),
    roles,
    idtyp,
    ...(typeof payload.tid === "string" ? { tid: payload.tid } : {}),
    ...(typeof payload.name === "string" ? { name: payload.name } : {}),
  };
}

function makeVerifier(keys: JWTVerifyGetKey, issuer: string, audience: string): Verifier {
  const tolerance = platformConfig().auth.clock_tolerance_s;
  return {
    issuer,
    audience,
    async verify(token: string) {
      try {
        const { payload } = await jwtVerify(token, keys, {
          issuer,
          audience,
          algorithms: ["RS256"],
          clockTolerance: tolerance,
          requiredClaims: ["exp", "iat", "oid"],
        });
        return claimsOf(payload);
      } catch (err) {
        if (err instanceof AuthError) throw err;
        throw new AuthError(`invalid token: ${(err as Error).message}`);
      }
    },
  };
}

/** Production verifier: Entra ID's published signing keys, fetched and cached by jose. */
export function entraVerifier(env: NodeJS.ProcessEnv = process.env): Verifier {
  const cfg = platformConfig().auth;
  const issuer = substituteEnv(cfg.issuer, env);
  const jwks = substituteEnv(cfg.jwks_uri, env);
  if (issuer.includes("${") || jwks.includes("${")) throw new Error("ENTRA_TENANT_ID is not set");
  return makeVerifier(createRemoteJWKSet(new URL(jwks)), issuer, env.ENTRA_AUDIENCE ?? cfg.audience);
}

/** A local issuer with its own key pair, for development and tests. */
export class DevIssuer implements Verifier {
  readonly issuer = platformConfig().auth.dev_issuer;
  readonly audience = platformConfig().auth.audience;
  private constructor(
    private readonly privateKey: CryptoKey,
    readonly jwks: JSONWebKeySet,
    private readonly inner: Verifier,
  ) {}

  static async create(): Promise<DevIssuer> {
    const { publicKey, privateKey } = await generateKeyPair("RS256", { extractable: true });
    const jwk = { ...(await exportJWK(publicKey)), kid: "dev-1", alg: "RS256", use: "sig" };
    const jwks = { keys: [jwk] };
    const issuer = platformConfig().auth.dev_issuer;
    return new DevIssuer(
      privateKey,
      jwks,
      makeVerifier(createLocalJWKSet(jwks), issuer, platformConfig().auth.audience),
    );
  }

  verify(token: string) {
    return this.inner.verify(token);
  }

  async sign(
    claims: { oid: string; roles: string[]; idtyp?: "app" | "user"; name?: string },
    ttlSeconds = 3600,
    overrides: JWTPayload = {},
  ) {
    return new SignJWT({
      oid: claims.oid,
      roles: claims.roles,
      idtyp: claims.idtyp ?? "user",
      name: claims.name,
      ...overrides,
    })
      .setProtectedHeader({ alg: "RS256", kid: "dev-1" })
      .setIssuer((overrides.iss as string) ?? this.issuer)
      .setAudience((overrides.aud as string) ?? this.audience)
      .setIssuedAt()
      .setExpirationTime(`${ttlSeconds}s`)
      .sign(this.privateKey);
  }
}

/** The dev issuer must never verify tokens in production. */
export function assertAuthModeAllowed(mode: string, env: NodeJS.ProcessEnv = process.env): void {
  if (mode === "dev" && env.NODE_ENV === "production") {
    throw new Error("AUTH_MODE=dev is refused when NODE_ENV=production");
  }
  if (mode !== "dev" && mode !== "entra") throw new Error(`unknown AUTH_MODE ${mode}`);
}

/** Read the bearer token from an Authorization header. */
export function bearer(header: string | undefined): string {
  if (!header) throw new AuthError("missing Authorization header");
  const m = /^Bearer\s+([A-Za-z0-9._~+/=-]+)$/.exec(header);
  if (!m) throw new AuthError("Authorization header is not a bearer token");
  return m[1]!;
}
