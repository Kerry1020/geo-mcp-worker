// Pure helpers: validation and geometry.

export function round6(v) {
  return Number(Number(v).toFixed(6));
}

export function haversineMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Accepts numbers or numeric strings; returns a finite number or null.
export function toNumber(v) {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

// Returns { lat, lon } or null when either value is missing, non-numeric or out of range.
export function parseCoords(lat, lon) {
  const la = toNumber(lat);
  const lo = toNumber(lon);
  if (la == null || lo == null) return null;
  if (la < -90 || la > 90 || lo < -180 || lo > 180) return null;
  return { lat: la, lon: lo };
}

// Integer clamped to [min, max]; falls back to `fallback` when not numeric.
export function clampInt(v, min, max, fallback) {
  const n = toNumber(v);
  if (n == null) return fallback;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

export function isPlainObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}
