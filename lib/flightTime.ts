export type Coords = { lat: number; lon: number };
const R = 6371; // km
const toRad = (d: number) => (d * Math.PI) / 180;
export function haversineKm(a: Coords, b: Coords) {
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const la1 = toRad(a.lat), la2 = toRad(b.lat);
  const sinDLat = Math.sin(dLat/2), sinDLon = Math.sin(dLon/2);
  const h = sinDLat*sinDLat + Math.cos(la1)*Math.cos(la2)*sinDLon*sinDLon;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}
const cache = new Map<string, number>();
export function estimateFlightHours(origin: Coords, dest: Coords) {
  const k = `${origin.lat.toFixed(3)},${origin.lon.toFixed(3)}|${dest.lat.toFixed(3)},${dest.lon.toFixed(3)}`;
  const hit = cache.get(k);
  if (hit) return hit;
  const km = haversineKm(origin, dest);
  const hours = km / 800 + 0.7; // cruise + buffer
  cache.set(k, hours);
  return hours;
}
