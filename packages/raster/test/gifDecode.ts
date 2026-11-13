/**
 * A GIF reader for the tests, written against the GIF89a specification and sharing no code with the encoder, so
 * a test that decodes what `encodeGif` wrote is checking the file and not the encoder against itself.
 */
/** `rect` is the part of the canvas the frame itself carries: x, y, width, height. */
export interface GifFrame { delayCs: number; rgba: Buffer; rect: [number, number, number, number]; transparentPixels: number }
export interface Gif { width: number; height: number; loops: number | undefined; colours: number; frames: GifFrame[] }

function lzw(data: Uint8Array, minCode: number, pixels: number): Uint8Array {
  const out = new Uint8Array(pixels);
  const clear = 1 << minCode, end = clear + 1;
  const prefix = new Int32Array(4096), suffix = new Uint8Array(4096), stack = new Uint8Array(4097);
  let size = minCode + 1, next = end + 1, prev = -1, first = 0, bits = 0, acc = 0, at = 0, n = 0;
  while (n < pixels) {
    while (bits < size && at < data.length) { acc |= data[at++]! << bits; bits += 8; }
    if (bits < size) break;
    const code = acc & ((1 << size) - 1);
    acc >>= size; bits -= size;
    if (code === clear) { size = minCode + 1; next = end + 1; prev = -1; continue; }
    if (code === end) break;
    let c = code, top = 0;
    if (prev === -1) { out[n++] = code; prev = code; first = code; continue; }
    if (code >= next) { stack[top++] = first; c = prev; }
    while (c > clear) { stack[top++] = suffix[c]!; c = prefix[c]!; }
    first = c;
    stack[top++] = c;
    while (top > 0 && n < pixels) out[n++] = stack[--top]!;
    if (next < 4096) { prefix[next] = prev; suffix[next] = first; next++; if (next === 1 << size && size < 12) size++; }
    prev = code;
  }
  if (n !== pixels) throw new Error(`gif: image data ends after ${n} of ${pixels} pixels`);
  return out;
}

/** Every frame as the full canvas a viewer shows while it is up (frames are composed as a viewer composes them). */
export function decodeGif(b: Buffer): Gif {
  if (b.toString("latin1", 0, 6) !== "GIF89a") throw new Error("not a GIF89a file");
  const width = b.readUInt16LE(6), height = b.readUInt16LE(8), packed = b[10]!;
  let p = 13;
  let palette: Buffer = Buffer.alloc(0);
  if (packed & 0x80) { const n = 3 * (1 << ((packed & 7) + 1)); palette = b.subarray(p, p + n); p += n; }
  const canvas = Buffer.alloc(width * height * 4);
  const frames: GifFrame[] = [];
  let loops: number | undefined, delayCs = 0, transparent = -1, dispose = 0;
  const blocks = () => { const parts: Buffer[] = []; for (let n = b[p++]!; n > 0; n = b[p++]!) { parts.push(b.subarray(p, p + n)); p += n; } return Buffer.concat(parts); };
  for (;;) {
    const kind = b[p++];
    if (kind === 0x3b) break;
    if (kind === 0x21) {
      const label = b[p++];
      const body = blocks();
      if (label === 0xf9) { dispose = (body[0]! >> 2) & 7; delayCs = body.readUInt16LE(1); transparent = body[0]! & 1 ? body[3]! : -1; }
      if (label === 0xff && body.toString("latin1", 0, 11) === "NETSCAPE2.0") loops = body.readUInt16LE(12);
      continue;
    }
    if (kind !== 0x2c) throw new Error(`gif: unexpected block 0x${kind?.toString(16)} at ${p - 1}`);
    const x = b.readUInt16LE(p), y = b.readUInt16LE(p + 2), w = b.readUInt16LE(p + 4), h = b.readUInt16LE(p + 6), flags = b[p + 8]!;
    p += 9;
    if (flags & 0x40) throw new Error("gif: interlaced frames are not written by the encoder");
    let table = palette;
    if (flags & 0x80) { const n = 3 * (1 << ((flags & 7) + 1)); table = b.subarray(p, p + n); p += n; }
    const minCode = b[p++]!;
    const index = lzw(blocks(), minCode, w * h);
    if (dispose > 1) throw new Error("gif: the encoder leaves every frame in place");
    let clear = 0;
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      const c = index[j * w + i]!;
      if (c === transparent) { clear++; continue; }
      const o = ((y + j) * width + x + i) * 4;
      canvas[o] = table[c * 3]!; canvas[o + 1] = table[c * 3 + 1]!; canvas[o + 2] = table[c * 3 + 2]!; canvas[o + 3] = 255;
    }
    frames.push({ delayCs, rgba: Buffer.from(canvas), rect: [x, y, w, h], transparentPixels: clear });
    delayCs = 0; transparent = -1; dispose = 0;
  }
  return { width, height, loops, colours: palette.length / 3, frames };
}
