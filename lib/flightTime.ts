export type Coords = { lat: number; lon: number };
const R = 6371;
const toRad = (d: number) => (d * Math.PI) / 180;

export function haversineKm(a: Coords, b: Coords) {
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const la1 = toRad(a.lat), la2 = toRad(b.lat);
  const h = Math.sin(dLat/2)**2 + Math.cos(la1)*Math.cos(la2)*Math.sin(dLon/2)**2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

const cache = new Map<string, number>();
export function estimateFlightHours(origin: Coords, dest: Coords) {
  const key = `${origin.lat.toFixed(3)},${origin.lon.toFixed(3)}|${dest.lat.toFixed(3)},${dest.lon.toFixed(3)}`;
  if (cache.has(key)) return cache.get(key)!;
  const hours = haversineKm(origin, dest) / 800 + 0.7;
  cache.set(key, hours);
  return hours;
}
