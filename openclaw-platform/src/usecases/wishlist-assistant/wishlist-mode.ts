export type WishlistMode = "deterministic" | "tool" | "hybrid" | "legacy";

export function resolveWishlistMode(rawMode = process.env.WISHLIST_MODE): WishlistMode {
  const normalized = String(rawMode ?? "").trim().toLowerCase();
  if (normalized === "deterministic" || normalized === "tool" || normalized === "hybrid" || normalized === "legacy") {
    return normalized;
  }

  const legacyExactDispatch = String(process.env.WISHLIST_EXACT_DISPATCH ?? "").trim().toLowerCase();
  if (legacyExactDispatch === "0" || legacyExactDispatch === "false" || legacyExactDispatch === "no" || legacyExactDispatch === "off") {
    return "legacy";
  }

  return "deterministic";
}

export function wishlistModeUsesDeterministic(mode = resolveWishlistMode()): boolean {
  return mode === "deterministic" || mode === "hybrid";
}

export function wishlistModeUsesTool(mode = resolveWishlistMode()): boolean {
  return mode === "tool" || mode === "hybrid";
}
