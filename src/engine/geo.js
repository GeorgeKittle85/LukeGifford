// Great-circle geometry. Shared by the engine (distances) and the map
// (flight paths and plane positions).

const EARTH_RADIUS_MI = 3958.8;
const toRad = (deg) => (deg * Math.PI) / 180;
const toDeg = (rad) => (rad * 180) / Math.PI;

export function distanceMiles(a, b) {
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_MI * Math.asin(Math.min(1, Math.sqrt(h)));
}

// Point at fraction f (0..1) along the great circle from a to b.
export function interpolate(a, b, f) {
  const lat1 = toRad(a.lat), lon1 = toRad(a.lon);
  const lat2 = toRad(b.lat), lon2 = toRad(b.lon);
  const d = 2 * Math.asin(Math.sqrt(
    Math.sin((lat2 - lat1) / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin((lon2 - lon1) / 2) ** 2,
  ));
  if (d === 0) return { lat: a.lat, lon: a.lon };
  const A = Math.sin((1 - f) * d) / Math.sin(d);
  const B = Math.sin(f * d) / Math.sin(d);
  const x = A * Math.cos(lat1) * Math.cos(lon1) + B * Math.cos(lat2) * Math.cos(lon2);
  const y = A * Math.cos(lat1) * Math.sin(lon1) + B * Math.cos(lat2) * Math.sin(lon2);
  const z = A * Math.sin(lat1) + B * Math.sin(lat2);
  return { lat: toDeg(Math.atan2(z, Math.sqrt(x * x + y * y))), lon: toDeg(Math.atan2(y, x)) };
}

// Initial compass bearing (degrees clockwise from north) from p toward q.
export function bearing(p, q) {
  const lat1 = toRad(p.lat), lat2 = toRad(q.lat);
  const dLon = toRad(q.lon - p.lon);
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

// Sample a great-circle path as a list of points with continuous longitudes
// (no jumps at the antimeridian), starting from the origin's own longitude.
export function greatCirclePath(a, b, segments = 64) {
  const points = [];
  let prevLon = a.lon;
  for (let i = 0; i <= segments; i++) {
    const p = interpolate(a, b, i / segments);
    let lon = p.lon;
    while (lon - prevLon > 180) lon -= 360;
    while (lon - prevLon < -180) lon += 360;
    points.push({ lat: p.lat, lon });
    prevLon = lon;
  }
  return points;
}
