// The world map: Leaflet + OpenStreetMap tiles (darkened with CSS), with a
// bundled Natural Earth outline map underneath as the offline fallback.
//
// Longitudes are drawn in a window from -330 to +30 so the whole network is
// one continuous picture: the Americas in the middle, London to the east,
// Tokyo to the west across the Pacific (where trans-Pacific flights go).

import { AIRPORTS, AIRPORT_BY_CODE } from '../../data/airports.js';
import { flightPosition, routePath } from '../../engine/selectors.js';
import { utcMs } from '../../engine/time.js';
import { decodePolygons } from './topojson.js';
import { nightPolygon } from './terminator.js';

const W_MIN = -330;
const W_MAX = 30;
const GOLD = '#f5c542';
const TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';

export function normLon(lon) {
  return ((((lon - W_MIN) % 360) + 360) % 360) + W_MIN;
}

// Normalize a continuous path into the window, splitting where it wraps.
function splitPath(points) {
  const segments = [];
  let current = [];
  let prev = null;
  for (const p of points) {
    const lon = normLon(p.lon);
    if (prev !== null && Math.abs(lon - prev) > 180) {
      if (current.length > 1) segments.push(current);
      current = [];
    }
    current.push([p.lat, lon]);
    prev = lon;
  }
  if (current.length > 1) segments.push(current);
  return segments;
}

const PLANE_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 1.6c.9 0 1.4.8 1.4 1.8v5.9l8 4.7v2.3l-8-2.5v4.7l2.3 1.8v1.6L12 21l-3.7 1v-1.6l2.3-1.8v-4.7l-8 2.5v-2.3l8-4.7V3.4c0-1 .5-1.8 1.4-1.8z"/></svg>';

export function createMapView(el, { renderAirportPopup, renderFlightPopup, onNetworkStatus }) {
  const L = window.L;
  const map = L.map(el, {
    minZoom: 2,
    maxZoom: 13,
    zoomSnap: 1, // whole zoom levels keep the darkened tiles crisp and seam-free
    maxBounds: [[-75, W_MIN - 5], [85, W_MAX + 5]],
    maxBoundsViscosity: 0.8,
    worldCopyJump: false,
    zoomControl: true,
  }).setView([38, -98], 4);
  map.attributionControl.setPrefix('<a href="https://leafletjs.com" target="_blank" rel="noopener">Leaflet</a>');

  for (const [name, z] of [['fallback', 150], ['night', 350], ['routes', 420], ['airports', 450], ['planes', 620], ['storms', 630]]) {
    map.createPane(name).style.zIndex = String(z);
  }
  map.getPane('night').style.pointerEvents = 'none';
  map.getPane('routes').style.pointerEvents = 'none';

  // --- basemap: online tiles over an offline outline map --------------------
  const tiles = L.tileLayer(TILE_URL, {
    maxZoom: 19,
    className: 'ks-tiles',
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors',
  }).addTo(map);
  let loaded = 0, failed = 0, status = 'unknown';
  const reportStatus = () => {
    const next = loaded > 0 && failed < loaded * 2 ? 'online' : failed > 0 ? 'offline' : status;
    if (next !== status) {
      status = next;
      onNetworkStatus?.(status);
    }
  };
  tiles.on('tileload', () => { loaded++; reportStatus(); });
  tiles.on('tileerror', () => { failed++; reportStatus(); });

  import('../../data/worldCountries50m.js').then(({ default: topo }) => {
    const polygons = decodePolygons(topo, 'countries');
    const latlngs = [];
    for (const offset of [0, -360]) {
      for (const poly of polygons) latlngs.push(poly.map((ring) => ring.map(([lon, lat]) => [lat, lon + offset])));
    }
    L.polygon(latlngs, {
      pane: 'fallback',
      renderer: L.canvas({ pane: 'fallback', padding: 0.3 }),
      color: '#3a4a6b', weight: 0.8, fillColor: '#1a2540', fillOpacity: 1, interactive: false,
    }).addTo(map);
  }).catch((err) => console.warn('Fallback map failed to load', err));

  // --- layers ----------------------------------------------------------------
  const airportLayer = L.layerGroup().addTo(map);
  const routeLayer = L.layerGroup().addTo(map);
  const rivalRouteLayer = L.layerGroup();
  const stormLayer = L.layerGroup().addTo(map);
  let nightLayer = null;
  let lastNightT = -Infinity;
  let stormKey = '';
  const planes = new Map(); // flightId -> { marker, heading }
  const options = { showRivals: true, showRivalRoutes: false, showNight: true, kittleMode: false };

  function openPopup(latlng, content) {
    L.popup({ offset: [0, -4], maxWidth: 320, autoPanPadding: [40, 40] }).setLatLng(latlng).setContent(content).openOn(map);
  }

  function buildAirports(state) {
    airportLayer.clearLayers();
    const me = state.airlines[state.humanAirlineId];
    const rivalHubs = new Set(Object.values(state.airlines).filter((a) => a.controller === 'ai').flatMap((a) => a.hubs));
    for (const ap of AIRPORTS) {
      const latlng = [ap.lat, normLon(ap.lon)];
      const mine = me.hubs.includes(ap.code);
      const marker = L.circleMarker(latlng, {
        pane: 'airports',
        radius: mine ? 8 : 6,
        color: mine ? GOLD : rivalHubs.has(ap.code) ? '#9fb3d9' : '#d8e0f0',
        weight: mine ? 3 : 2,
        fillColor: '#0d1424',
        fillOpacity: 1,
      });
      marker.bindTooltip(ap.code, { permanent: true, direction: 'right', offset: [8, 0], className: `ks-ap-label${mine ? ' hub' : ''}` });
      marker.on('click', () => openPopup(latlng, renderAirportPopup(ap.code)));
      marker.addTo(airportLayer);
    }
  }

  function buildRoutes(state) {
    routeLayer.clearLayers();
    rivalRouteLayer.clearLayers();
    const activeRoutes = new Set(Object.values(state.planes).filter((p) => p.routeId).map((p) => p.routeId));
    for (const route of Object.values(state.routes)) {
      const mine = route.airlineId === state.humanAirlineId;
      const airline = state.airlines[route.airlineId];
      const segments = splitPath(routePath(route.a, route.b));
      const style = mine
        ? { color: GOLD, weight: 2.5, opacity: activeRoutes.has(route.id) ? 0.9 : 0.45, dashArray: activeRoutes.has(route.id) ? null : '6 6' }
        : { color: airline.color, weight: 1.2, opacity: 0.5, dashArray: '3 6' };
      L.polyline(segments, { pane: 'routes', interactive: false, ...style }).addTo(mine ? routeLayer : rivalRouteLayer);
    }
  }

  function planeIcon(flight, color, mine) {
    const size = mine ? 22 : 16;
    const glyph = options.kittleMode ? '<span class="ks-football">🏈</span>' : PLANE_SVG;
    return L.divIcon({
      className: `ks-plane ${mine ? 'mine' : 'rival'}`,
      html: `<div class="ks-plane-rot" style="color:${color}">${glyph}</div>`,
      iconSize: [size, size],
      iconAnchor: [size / 2, size / 2],
    });
  }

  function updatePlanes(state) {
    const seen = new Set();
    for (const flight of Object.values(state.flights)) {
      const mine = flight.airlineId === state.humanAirlineId;
      if (!mine && !options.showRivals) continue;
      seen.add(flight.id);
      const pos = flightPosition(flight, state.now);
      const latlng = [pos.lat, normLon(pos.lon)];
      let entry = planes.get(flight.id);
      if (!entry) {
        const color = mine ? GOLD : state.airlines[flight.airlineId].color;
        const marker = L.marker(latlng, { icon: planeIcon(flight, color, mine), pane: 'planes', keyboard: false, title: flight.flightNo, zIndexOffset: mine ? 1000 : 0 });
        marker.on('click', () => openPopup(marker.getLatLng(), renderFlightPopup(flight.id)));
        marker.addTo(map);
        entry = { marker, heading: null };
        planes.set(flight.id, entry);
      } else {
        entry.marker.setLatLng(latlng);
      }
      if (entry.heading === null || Math.abs(entry.heading - pos.heading) > 0.5) {
        const rot = entry.marker.getElement()?.firstElementChild;
        if (rot) {
          rot.style.transform = `rotate(${pos.heading.toFixed(1)}deg)`;
          entry.heading = pos.heading;
        }
      }
    }
    for (const [id, entry] of planes) {
      if (!seen.has(id)) {
        entry.marker.remove();
        planes.delete(id);
      }
    }
  }

  function updateStorms(state) {
    const storms = state.activeEvents.filter((e) => e.type === 'storm' && e.startT <= state.now && state.now < e.endT);
    const key = storms.map((s) => s.id).join(',');
    if (key === stormKey) return;
    stormKey = key;
    stormLayer.clearLayers();
    for (const s of storms) {
      const ap = AIRPORT_BY_CODE[s.target];
      L.marker([ap.lat + 0.9, normLon(ap.lon) - 0.9], {
        pane: 'storms',
        icon: L.divIcon({ className: 'ks-storm', html: '<span>⛈</span>', iconSize: [24, 24], iconAnchor: [12, 12] }),
        keyboard: false,
      }).bindTooltip(s.title, { direction: 'top' }).addTo(stormLayer);
    }
  }

  function updateNight(state) {
    if (!options.showNight) {
      if (nightLayer) { nightLayer.remove(); nightLayer = null; }
      return;
    }
    if (nightLayer && Math.abs(state.now - lastNightT) < 10) return;
    lastNightT = state.now;
    const latlngs = nightPolygon(utcMs(state, state.now), W_MIN - 5, W_MAX + 5);
    if (!nightLayer) {
      nightLayer = L.polygon(latlngs, { pane: 'night', stroke: false, fillColor: '#000814', fillOpacity: 0.28, interactive: false }).addTo(map);
    } else {
      nightLayer.setLatLngs(latlngs);
    }
  }

  function clearPlanes() {
    for (const entry of planes.values()) entry.marker.remove();
    planes.clear();
  }

  return {
    map,
    rebuild(state) {
      buildAirports(state);
      buildRoutes(state);
      stormKey = '';
      lastNightT = -Infinity;
      clearPlanes();
    },
    refreshRoutes(state) {
      buildRoutes(state);
    },
    frame(state) {
      updatePlanes(state);
      updateStorms(state);
      updateNight(state);
    },
    setOption(key, value, state) {
      options[key] = value;
      if (key === 'showRivalRoutes') {
        if (value) rivalRouteLayer.addTo(map);
        else rivalRouteLayer.remove();
      }
      if (key === 'kittleMode' || key === 'showRivals') clearPlanes();
      if (key === 'showNight') { lastNightT = -Infinity; if (state) updateNight(state); }
    },
    getOption(key) {
      return options[key];
    },
    focusAirport(code, zoom = 5) {
      const ap = AIRPORT_BY_CODE[code];
      map.flyTo([ap.lat, normLon(ap.lon)], Math.max(map.getZoom(), zoom), { duration: 0.8 });
    },
    focusFlight(state, flightId) {
      const f = state.flights[flightId];
      if (!f) return;
      const pos = flightPosition(f, state.now);
      map.flyTo([pos.lat, normLon(pos.lon)], Math.max(map.getZoom(), 5), { duration: 0.8 });
    },
    invalidate() {
      map.invalidateSize();
    },
  };
}
