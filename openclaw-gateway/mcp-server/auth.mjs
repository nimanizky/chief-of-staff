import { createPublicKey, constants, verify as cryptoVerify } from "node:crypto";

export class OAuthError extends Error {
  constructor(code, message, requiredScope) {
    super(message);
    this.name = "OAuthError";
    this.code = code;
    this.requiredScope = requiredScope;
  }
}

export function createJwtVerifier({ issuer, jwksUrl, audience, fetchImpl = fetch, cacheMs = 5 * 60_000 }) {
  if (!issuer || !jwksUrl || !audience) throw new Error("MCP OAuth issuer, JWKS URL, and audience are required.");
  let cachedJwks = null;
  let cachedAt = 0;

  async function getJwks() {
    if (cachedJwks && Date.now() - cachedAt < cacheMs) return cachedJwks;
    const response = await fetchImpl(jwksUrl, { signal: AbortSignal.timeout(5_000) });
    if (!response.ok) throw new OAuthError("invalid_token", "The authorization server signing keys are unavailable.");
    const body = await response.json();
    if (!Array.isArray(body.keys)) throw new OAuthError("invalid_token", "The authorization server returned an invalid JWKS document.");
    cachedJwks = body.keys;
    cachedAt = Date.now();
    return cachedJwks;
  }

  return async function verifyAccessToken(token, requiredScopes = []) {
    if (typeof token !== "string" || token.length > 16_384) {
      throw new OAuthError("invalid_token", "A valid OAuth access token is required.");
    }
    const parts = token.split(".");
    if (parts.length !== 3) throw new OAuthError("invalid_token", "The access token is not a supported JWT.");

    let header;
    let claims;
    let signature;
    try {
      header = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8"));
      claims = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
      signature = Buffer.from(parts[2], "base64url");
    } catch {
      throw new OAuthError("invalid_token", "The access token is malformed.");
    }

    if (!["RS256", "PS256", "ES256"].includes(header.alg)) {
      throw new OAuthError("invalid_token", "The access token uses an unsupported signing algorithm.");
    }
    const keys = await getJwks();
    const expectedKeyType = header.alg === "ES256" ? "EC" : "RSA";
    const candidates = keys.filter((key) =>
      key.kty === expectedKeyType &&
      (!header.kid || key.kid === header.kid) &&
      (!key.alg || key.alg === header.alg) &&
      (!key.use || key.use === "sig") &&
      (!Array.isArray(key.key_ops) || key.key_ops.includes("verify"))
    );
    if (candidates.length !== 1) throw new OAuthError("invalid_token", "The access token signing key could not be selected.");

    let valid = false;
    try {
      const publicKey = createPublicKey({ key: candidates[0], format: "jwk" });
      const signedData = Buffer.from(`${parts[0]}.${parts[1]}`);
      if (header.alg === "RS256") {
        valid = cryptoVerify("RSA-SHA256", signedData, publicKey, signature);
      } else if (header.alg === "PS256") {
        valid = cryptoVerify("sha256", signedData, { key: publicKey, padding: constants.RSA_PKCS1_PSS_PADDING, saltLength: 32 }, signature);
      } else {
        valid = cryptoVerify("sha256", signedData, { key: publicKey, dsaEncoding: "ieee-p1363" }, signature);
      }
    } catch {
      throw new OAuthError("invalid_token", "The access token signature could not be verified.");
    }
    if (!valid) throw new OAuthError("invalid_token", "The access token signature is invalid.");

    const now = Math.floor(Date.now() / 1000);
    if (claims.iss !== issuer) throw new OAuthError("invalid_token", "The access token issuer does not match.");
    const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (!audiences.includes(audience) && claims.resource !== audience) {
      throw new OAuthError("invalid_token", "The access token was not issued for this MCP server.");
    }
    if (!Number.isFinite(claims.exp) || claims.exp <= now) throw new OAuthError("invalid_token", "The access token has expired.");
    if (Number.isFinite(claims.nbf) && claims.nbf > now + 30) throw new OAuthError("invalid_token", "The access token is not active yet.");
    if (typeof claims.sub !== "string" || !claims.sub.trim()) throw new OAuthError("invalid_token", "The access token has no subject.");

    const scopes = new Set([
      ...(typeof claims.scope === "string" ? claims.scope.split(/\s+/) : []),
      ...(Array.isArray(claims.scp) ? claims.scp.filter((scope) => typeof scope === "string") : [])
    ]);
    const missing = requiredScopes.filter((scope) => !scopes.has(scope));
    if (missing.length) throw new OAuthError("insufficient_scope", `The access token is missing required scope: ${missing.join(" ")}.`, missing.join(" "));
    return { subject: claims.sub, scopes, claims };
  };
}

export function createAuthChallenge({ publicUrl, error = "invalid_token", description = "Connect an authorized account to use this tool.", scope }) {
  const metadataUrl = `${publicUrl.replace(/\/$/, "")}/.well-known/oauth-protected-resource`;
  const safeDescription = description.replace(/["\\]/g, "");
  const scopePart = scope ? `, scope="${scope}"` : "";
  return `Bearer resource_metadata="${metadataUrl}", error="${error}", error_description="${safeDescription}"${scopePart}`;
}
