/*
 * Generates the PWA icons as PNGs with a small dependency-free rasteriser.
 * Run: node tools/make-icons.js
 *
 * Everything is drawn in a 100x100 coordinate space, supersampled 4x for
 * anti-aliasing, then box-filtered down to the requested resolution.
 */
const zlib = require('zlib');
const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, '..', 'icons');
const SCALE = 4;

const BG = [253, 227, 188];        // #FDE3BC warm apricot
const OUTLINE = [201, 122, 46];    // #C97A2E darker ginger (silhouette outline)
const FUR = [240, 162, 78];        // #F0A24E ginger
const EAR = [246, 183, 174];       // #F6B7AE pink
const DARK = [74, 58, 48];         // #4A3A30
const NOSE = [217, 112, 100];      // #D97064
const LIGHT = [255, 250, 240];

function canvas(size) {
  const S = size * SCALE;
  // The drawing uses a 100x100 design space; `unit` maps it to canvas pixels.
  return { S, unit: S / 100, data: new Uint8ClampedArray(S * S * 4) };
}

function forEachPixel(c, x0, y0, x1, y1, fn) {
  const u = c.unit;
  const ix0 = Math.max(0, Math.floor(x0 * u));
  const ix1 = Math.min(c.S - 1, Math.ceil(x1 * u));
  const iy0 = Math.max(0, Math.floor(y0 * u));
  const iy1 = Math.min(c.S - 1, Math.ceil(y1 * u));
  for (let iy = iy0; iy <= iy1; iy++) {
    const py = (iy + 0.5) / u;
    for (let ix = ix0; ix <= ix1; ix++) {
      fn((ix + 0.5) / u, py, ix, iy);
    }
  }
}

function put(c, ix, iy, rgb) {
  const o = (iy * c.S + ix) * 4;
  c.data[o] = rgb[0];
  c.data[o + 1] = rgb[1];
  c.data[o + 2] = rgb[2];
  c.data[o + 3] = 255;
}

function rect(c, x0, y0, x1, y1, rgb) {
  forEachPixel(c, x0, y0, x1, y1, function (_px, _py, ix, iy) { put(c, ix, iy, rgb); });
}

function ellipse(c, cx, cy, rx, ry, rgb) {
  forEachPixel(c, cx - rx, cy - ry, cx + rx, cy + ry, function (px, py, ix, iy) {
    const u = (px - cx) / rx;
    const v = (py - cy) / ry;
    if (u * u + v * v <= 1) put(c, ix, iy, rgb);
  });
}

function inPoly(px, py, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const xi = pts[i][0], yi = pts[i][1];
    const xj = pts[j][0], yj = pts[j][1];
    if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function poly(c, pts, rgb) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of pts) {
    x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]);
    x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]);
  }
  forEachPixel(c, x0, y0, x1, y1, function (px, py, ix, iy) {
    if (inPoly(px, py, pts)) put(c, ix, iy, rgb);
  });
}

function distSeg(px, py, x0, y0, x1, y1) {
  const dx = x1 - x0, dy = y1 - y0;
  const len2 = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((px - x0) * dx + (py - y0) * dy) / len2));
  return Math.hypot(px - (x0 + t * dx), py - (y0 + t * dy));
}

function line(c, x0, y0, x1, y1, width, rgb) {
  const pad = width;
  forEachPixel(c, Math.min(x0, x1) - pad, Math.min(y0, y1) - pad,
                  Math.max(x0, x1) + pad, Math.max(y0, y1) + pad,
    function (px, py, ix, iy) {
      if (distSeg(px, py, x0, y0, x1, y1) <= width / 2) put(c, ix, iy, rgb);
    });
}

function draw(c) {
  rect(c, 0, 0, 100, 100, BG);

  // Ears: a slightly larger dark silhouette behind the ginger fill.
  const earLDark = [[26, 40], [25, 14], [47, 28]];
  const earRDark = [[74, 40], [75, 14], [53, 28]];
  const earL = [[29, 39], [28, 19], [44, 30]];
  const earR = [[71, 39], [72, 19], [56, 30]];
  poly(c, earLDark, OUTLINE);
  poly(c, earRDark, OUTLINE);

  // Head outline + face.
  ellipse(c, 50, 55, 30, 27, OUTLINE);
  ellipse(c, 50, 55, 28, 25, FUR);

  poly(c, earL, FUR);
  poly(c, earR, FUR);
  poly(c, [[32, 36], [31, 24], [42, 32]], EAR);
  poly(c, [[68, 36], [69, 24], [58, 32]], EAR);

  // Eyes with a tiny highlight.
  ellipse(c, 40, 52, 3.1, 4.3, DARK);
  ellipse(c, 60, 52, 3.1, 4.3, DARK);
  ellipse(c, 39, 50.5, 1.0, 1.2, LIGHT);
  ellipse(c, 59, 50.5, 1.0, 1.2, LIGHT);

  // Nose and mouth.
  poly(c, [[46.5, 62], [53.5, 62], [50, 65.5]], NOSE);
  line(c, 50, 65.5, 47.5, 69, 1.7, DARK);
  line(c, 47.5, 69, 43.5, 67.5, 1.7, DARK);
  line(c, 50, 65.5, 52.5, 69, 1.7, DARK);
  line(c, 52.5, 69, 56.5, 67.5, 1.7, DARK);

  // Whiskers.
  const w = 1.15;
  line(c, 31, 61, 16, 57.5, w, DARK);
  line(c, 31, 64.5, 15, 65, w, DARK);
  line(c, 31, 68, 17, 72.5, w, DARK);
  line(c, 69, 61, 84, 57.5, w, DARK);
  line(c, 69, 64.5, 85, 65, w, DARK);
  line(c, 69, 68, 83, 72.5, w, DARK);
}

function downsample(c, size) {
  const out = Buffer.alloc(size * size * 4);
  const s = SCALE;
  const n = s * s;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0;
      for (let dy = 0; dy < s; dy++) {
        for (let dx = 0; dx < s; dx++) {
          const o = ((y * s + dy) * c.S + (x * s + dx)) * 4;
          r += c.data[o]; g += c.data[o + 1]; b += c.data[o + 2];
        }
      }
      const p = (y * size + x) * 4;
      out[p] = Math.round(r / n);
      out[p + 1] = Math.round(g / n);
      out[p + 2] = Math.round(b / n);
      out[p + 3] = 255;
    }
  }
  return out;
}

// ---- PNG encoding ---------------------------------------------------------

const CRC_TABLE = (function () {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

function encodePNG(size, rgba) {
  const stride = size * 4 + 1;
  const raw = Buffer.alloc(stride * size);
  for (let y = 0; y < size; y++) {
    raw[y * stride] = 0; // filter: none
    rgba.copy(raw, y * stride + 1, y * size * 4, (y + 1) * size * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 6;   // RGBA
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

function main() {
  if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });
  for (const [name, size] of [['icon-192.png', 192], ['icon-512.png', 512], ['apple-touch-icon.png', 180]]) {
    const c = canvas(size);
    draw(c);
    const png = encodePNG(size, downsample(c, size));
    fs.writeFileSync(path.join(OUT, name), png);
    console.log('wrote', name, size + 'x' + size, png.length + ' bytes');
  }
}

main();
