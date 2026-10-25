// Minimal TopoJSON decoder (quantized arcs -> polygon rings in [lon, lat]).
// Enough for the world-atlas country file; avoids a library dependency.

export function decodePolygons(topo, objectName) {
  const [sx, sy] = topo.transform.scale;
  const [tx, ty] = topo.transform.translate;
  const arcs = topo.arcs.map((arc) => {
    let x = 0, y = 0;
    return arc.map(([dx, dy]) => {
      x += dx;
      y += dy;
      return [x * sx + tx, y * sy + ty];
    });
  });
  const arcPoints = (i) => (i >= 0 ? arcs[i] : arcs[~i].slice().reverse());
  const ring = (indices) => {
    const pts = [];
    indices.forEach((i, k) => {
      const a = arcPoints(i);
      for (let j = k === 0 ? 0 : 1; j < a.length; j++) pts.push(a[j]);
    });
    return pts;
  };

  const polygons = []; // each polygon = [outerRing, ...holes]
  for (const geom of topo.objects[objectName].geometries) {
    if (geom.type === 'Polygon') polygons.push(geom.arcs.map(ring));
    else if (geom.type === 'MultiPolygon') for (const poly of geom.arcs) polygons.push(poly.map(ring));
  }
  return polygons;
}
