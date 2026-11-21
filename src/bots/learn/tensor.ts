// A tensor in a weights file: base64 of little-endian float32 ('f4', the default) or float16 ('f2': half the
// size, for the experts the play screen downloads, BOT-NEXT.md N1). Both decode to Float32Array.

export interface TensorJson {
  shape: number[];
  data: string;
  dtype?: 'f4' | 'f2';
}

function bytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

let halves: Float32Array | null = null;

/** Every float16 bit pattern as a float32 (built once). */
function halfTable(): Float32Array {
  if (halves) return halves;
  halves = new Float32Array(65536);
  for (let h = 0; h < 65536; h++) {
    const sign = h & 0x8000 ? -1 : 1;
    const e = (h >> 10) & 0x1f;
    const f = h & 0x3ff;
    halves[h] = e === 0 ? sign * f * 2 ** -24 : e === 31 ? (f ? NaN : sign * Infinity) : sign * (1 + f / 1024) * 2 ** (e - 15);
  }
  return halves;
}

export function decodeTensor(t: TensorJson): Float32Array {
  const b = bytes(t.data);
  if (t.dtype === 'f2') {
    const h = new Uint16Array(b.buffer, b.byteOffset, b.byteLength / 2);
    const table = halfTable();
    const out = new Float32Array(h.length);
    for (let i = 0; i < h.length; i++) out[i] = table[h[i]!]!;
    return out;
  }
  return new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4);
}
