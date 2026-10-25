// Day/night terminator: the polygon of the Earth currently in darkness, for a
// UTC timestamp. Standard low-precision solar position (accurate to ~1°).

const rad = Math.PI / 180;

export function subsolarPoint(ms) {
  const n = ms / 86_400_000 + 2440587.5 - 2451545.0; // days since J2000
  const L = (280.46 + 0.9856474 * n) % 360;
  const g = ((357.528 + 0.9856003 * n) % 360) * rad;
  const lambda = (L + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * rad;
  const epsilon = (23.439 - 0.0000004 * n) * rad;
  const decl = Math.asin(Math.sin(epsilon) * Math.sin(lambda));
  const ra = Math.atan2(Math.cos(epsilon) * Math.sin(lambda), Math.cos(lambda));
  const gmstHours = (18.697374558 + 24.06570982441908 * n) % 24;
  let lon = ra / rad - gmstHours * 15;
  lon = ((lon + 540) % 360) - 180;
  return { lat: decl / rad, lon };
}

// Night polygon as Leaflet [lat, lng] pairs covering longitudes lonFrom..lonTo.
export function nightPolygon(ms, lonFrom, lonTo, step = 2) {
  const sun = subsolarPoint(ms);
  const decl = Math.abs(sun.lat) < 0.1 ? 0.1 : sun.lat;
  const pts = [];
  for (let lon = lonFrom; lon <= lonTo; lon += step) {
    const hourAngle = (lon - sun.lon) * rad;
    const lat = Math.atan(-Math.cos(hourAngle) / Math.tan(decl * rad)) / rad;
    pts.push([lat, lon]);
  }
  // Close the polygon over the pole that's in darkness.
  const pole = decl > 0 ? -85 : 85;
  pts.push([pole, lonTo], [pole, lonFrom]);
  return pts;
}
