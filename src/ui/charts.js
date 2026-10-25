// Small canvas charts for the Finances tab.
// Specs: columns <= 24px with 4px rounded data-ends (square at the baseline),
// 2px lines with a 10% area wash, hairline solid gridlines, hover tooltips,
// text in text colors (never the series color). Profit/loss uses the
// validated blue/red diverging pair; a single series needs no legend.

import { h } from './dom.js';

const COLORS = {
  positive: '#3987e5',
  negative: '#e66767',
  line: '#3987e5',
  grid: '#25304a',
  axis: '#3a4766',
  text: '#97a3bd',
  surface: '#121a2b',
  reference: '#8a96b0',
};

function niceStep(span, targetTicks = 4) {
  const raw = span / targetTicks;
  const mag = 10 ** Math.floor(Math.log10(raw || 1));
  const norm = raw / mag;
  return (norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10) * mag;
}

function scaleY(min, max) {
  const step = niceStep(max - min || 1);
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step || step;
  const ticks = [];
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(v);
  return { lo, hi, ticks };
}

function roundedBar(ctx, x, yBase, w, yEnd, r) {
  const up = yEnd < yBase;
  const hgt = Math.abs(yBase - yEnd);
  const rr = Math.min(r, hgt, w / 2);
  ctx.beginPath();
  if (up) {
    ctx.moveTo(x, yBase);
    ctx.lineTo(x, yEnd + rr);
    ctx.quadraticCurveTo(x, yEnd, x + rr, yEnd);
    ctx.lineTo(x + w - rr, yEnd);
    ctx.quadraticCurveTo(x + w, yEnd, x + w, yEnd + rr);
    ctx.lineTo(x + w, yBase);
  } else {
    ctx.moveTo(x, yBase);
    ctx.lineTo(x, yEnd - rr);
    ctx.quadraticCurveTo(x, yEnd, x + rr, yEnd);
    ctx.lineTo(x + w - rr, yEnd);
    ctx.quadraticCurveTo(x + w, yEnd, x + w, yEnd - rr);
    ctx.lineTo(x + w, yBase);
  }
  ctx.closePath();
  ctx.fill();
}

function makeChart({ data, height, format, draw, hitTest, ariaLabel }) {
  const canvas = h('canvas', { role: 'img', 'aria-label': ariaLabel });
  const tip = h('div', { class: 'chart-tip', hidden: true });
  const wrap = h('div', { class: 'chart' }, canvas, tip);
  let hover = -1;
  let ro = null;
  let drawn = false;

  const geom = () => {
    const width = wrap.clientWidth || 320;
    return { width, height, left: 48, right: 10, top: 10, bottom: 20 };
  };

  const render = () => {
    // Panels re-render often; stop observing once this chart is gone.
    if (drawn && !wrap.isConnected) {
      ro?.disconnect();
      return;
    }
    drawn = true;
    const g = geom();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(g.width * dpr);
    canvas.height = Math.round(g.height * dpr);
    canvas.style.width = `${g.width}px`;
    canvas.style.height = `${g.height}px`;
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, g.width, g.height);
    ctx.font = '11px system-ui, -apple-system, Segoe UI, sans-serif';
    if (!data.length) {
      ctx.fillStyle = COLORS.text;
      ctx.fillText('Data appears after your first weekly report.', g.left, g.height / 2);
      return;
    }
    draw(ctx, g, hover);
  };

  canvas.addEventListener('mousemove', (e) => {
    if (!data.length) return;
    const rect = canvas.getBoundingClientRect();
    const i = hitTest(e.clientX - rect.left, geom());
    if (i !== hover) {
      hover = i;
      render();
    }
    if (i >= 0) {
      tip.hidden = false;
      tip.textContent = `${data[i].label}: ${format(data[i].value)}`;
      const x = Math.min(rect.width - 120, Math.max(0, e.clientX - rect.left + 10));
      tip.style.left = `${x}px`;
      tip.style.top = '4px';
    } else {
      tip.hidden = true;
    }
  });
  canvas.addEventListener('mouseleave', () => {
    hover = -1;
    tip.hidden = true;
    render();
  });

  ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => render()) : null;
  ro?.observe(wrap);
  requestAnimationFrame(render);
  return wrap;
}

function drawYAxis(ctx, g, y, ticks, format) {
  ctx.lineWidth = 1;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  for (const v of ticks) {
    const py = Math.round(y(v)) + 0.5;
    ctx.strokeStyle = v === 0 ? COLORS.axis : COLORS.grid;
    ctx.beginPath();
    ctx.moveTo(g.left, py);
    ctx.lineTo(g.width - g.right, py);
    ctx.stroke();
    ctx.fillStyle = COLORS.text;
    ctx.fillText(format(v), g.left - 6, py);
  }
}

function drawXLabels(ctx, g, data, xCenter) {
  ctx.fillStyle = COLORS.text;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  const every = Math.max(1, Math.ceil(data.length / Math.max(1, Math.floor((g.width - g.left) / 48))));
  data.forEach((d, i) => {
    if ((data.length - 1 - i) % every === 0) ctx.fillText(d.label, xCenter(i), g.height - 5);
  });
}

// Weekly profit / loss columns.
export function profitChart(data, format) {
  const scaleFor = () => {
    const vals = data.map((d) => d.value);
    return scaleY(Math.min(0, ...vals), Math.max(0, ...vals));
  };
  return makeChart({
    data,
    height: 150,
    format: (v) => format(v, { sign: true }),
    ariaLabel: 'Weekly operating profit by week',
    hitTest: (mx, g) => {
      const band = (g.width - g.left - g.right) / data.length;
      const i = Math.floor((mx - g.left) / band);
      return i >= 0 && i < data.length ? i : -1;
    },
    draw: (ctx, g, hover) => {
      const s = scaleFor();
      const plotH = g.height - g.top - g.bottom;
      const y = (v) => g.top + ((s.hi - v) / (s.hi - s.lo)) * plotH;
      drawYAxis(ctx, g, y, s.ticks, (v) => format(v));
      const band = (g.width - g.left - g.right) / data.length;
      const barW = Math.max(2, Math.min(24, band - 2));
      const xCenter = (i) => g.left + band * i + band / 2;
      data.forEach((d, i) => {
        ctx.fillStyle = d.value >= 0 ? COLORS.positive : COLORS.negative;
        ctx.globalAlpha = hover === -1 || hover === i ? 1 : 0.55;
        roundedBar(ctx, xCenter(i) - barW / 2, y(0), barW, y(d.value), 4);
      });
      ctx.globalAlpha = 1;
      drawXLabels(ctx, g, data, xCenter);
    },
  });
}

// Cash balance line with an optional goal reference line.
export function cashChart(data, format, reference) {
  return makeChart({
    data,
    height: 150,
    format: (v) => format(v),
    ariaLabel: 'Cash balance by week',
    hitTest: (mx, g) => {
      if (data.length === 1) return 0;
      const step = (g.width - g.left - g.right) / (data.length - 1);
      const i = Math.round((mx - g.left) / step);
      return i >= 0 && i < data.length ? i : -1;
    },
    draw: (ctx, g, hover) => {
      const vals = data.map((d) => d.value);
      const hiVal = Math.max(...vals, reference && Math.max(...vals) > reference.value * 0.6 ? reference.value : -Infinity);
      const s = scaleY(Math.min(0, ...vals), Math.max(hiVal, 1));
      const plotH = g.height - g.top - g.bottom;
      const y = (v) => g.top + ((s.hi - v) / (s.hi - s.lo)) * plotH;
      drawYAxis(ctx, g, y, s.ticks, (v) => format(v));
      const step = data.length > 1 ? (g.width - g.left - g.right) / (data.length - 1) : 0;
      const x = (i) => g.left + step * i;

      if (reference && reference.value <= s.hi) {
        const ry = Math.round(y(reference.value)) + 0.5;
        ctx.strokeStyle = COLORS.reference;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(g.left, ry);
        ctx.lineTo(g.width - g.right, ry);
        ctx.stroke();
        ctx.fillStyle = COLORS.text;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'bottom';
        ctx.fillText(reference.label, g.left + 4, ry - 2);
      }

      // Area wash + line
      ctx.beginPath();
      data.forEach((d, i) => (i ? ctx.lineTo(x(i), y(d.value)) : ctx.moveTo(x(i), y(d.value))));
      ctx.lineTo(x(data.length - 1), y(Math.max(0, s.lo)));
      ctx.lineTo(x(0), y(Math.max(0, s.lo)));
      ctx.closePath();
      ctx.fillStyle = 'rgba(57, 135, 229, 0.10)';
      ctx.fill();
      ctx.beginPath();
      data.forEach((d, i) => (i ? ctx.lineTo(x(i), y(d.value)) : ctx.moveTo(x(i), y(d.value))));
      ctx.strokeStyle = COLORS.line;
      ctx.lineWidth = 2;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.stroke();

      const dot = (i) => {
        ctx.beginPath();
        ctx.arc(x(i), y(data[i].value), 4, 0, Math.PI * 2);
        ctx.fillStyle = COLORS.line;
        ctx.strokeStyle = COLORS.surface;
        ctx.lineWidth = 2;
        ctx.fill();
        ctx.stroke();
      };
      if (hover >= 0) {
        ctx.strokeStyle = COLORS.axis;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(Math.round(x(hover)) + 0.5, g.top);
        ctx.lineTo(Math.round(x(hover)) + 0.5, g.height - g.bottom);
        ctx.stroke();
        dot(hover);
      }
      dot(data.length - 1);
      drawXLabels(ctx, g, data, x);
    },
  });
}

// Reputation meter: fill color carries the state, always paired with a label.
export function repMeter(rep) {
  const level = rep >= 60 ? { cls: 'good', label: 'Strong', icon: '▲' } : rep >= 35 ? { cls: 'warn', label: 'Shaky', icon: '◆' } : { cls: 'bad', label: 'Poor', icon: '▼' };
  return h('div', { class: `meter meter-${level.cls}`, role: 'meter', 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': Math.round(rep), title: `Reputation ${Math.round(rep)}/100 (${level.label})` },
    h('div', { class: 'meter-track' }, h('div', { class: 'meter-fill', style: { width: `${Math.max(2, Math.min(100, rep))}%` } })),
    h('span', { class: 'meter-label' }, `${level.icon} ${Math.round(rep)} ${level.label}`));
}
