// Reads the pixel size from the header of a PNG, GIF, JPEG, or WebP file, without decoding it.

export interface ImageSize {
  width: number;
  height: number;
}

const ascii = (b: Buffer, start: number, end: number): string => b.toString("latin1", start, end);

function png(b: Buffer): ImageSize | undefined {
  if (b.length < 24 || ascii(b, 12, 16) !== "IHDR") return undefined;
  return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
}

function gif(b: Buffer): ImageSize | undefined {
  return b.length < 10 ? undefined : { width: b.readUInt16LE(6), height: b.readUInt16LE(8) };
}

function jpeg(b: Buffer): ImageSize | undefined {
  let i = 2;
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) {
      i++;
      continue;
    }
    const marker = b[i + 1] as number;
    if (marker === 0xff) {
      i++; // fill byte
      continue;
    }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      i += 2; // markers without a length
      continue;
    }
    const length = b.readUInt16BE(i + 2);
    const isStartOfFrame = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isStartOfFrame) return { width: b.readUInt16BE(i + 7), height: b.readUInt16BE(i + 5) };
    i += 2 + length;
  }
  return undefined;
}

function webp(b: Buffer): ImageSize | undefined {
  if (b.length < 30) return undefined;
  const kind = ascii(b, 12, 16);
  if (kind === "VP8X") return { width: 1 + b.readUIntLE(24, 3), height: 1 + b.readUIntLE(27, 3) };
  if (kind === "VP8 ") return { width: b.readUInt16LE(26) & 0x3fff, height: b.readUInt16LE(28) & 0x3fff };
  if (kind === "VP8L") {
    const bits = b.readUInt32LE(21);
    return { width: 1 + (bits & 0x3fff), height: 1 + ((bits >> 14) & 0x3fff) };
  }
  return undefined;
}

/** The size in pixels, or undefined when the format is unknown or the header is truncated. */
export function imageSize(bytes: Buffer): ImageSize | undefined {
  let size: ImageSize | undefined;
  if (bytes.length > 8 && bytes[0] === 0x89 && ascii(bytes, 1, 4) === "PNG") size = png(bytes);
  else if (ascii(bytes, 0, 4) === "GIF8") size = gif(bytes);
  else if (bytes[0] === 0xff && bytes[1] === 0xd8) size = jpeg(bytes);
  else if (ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 12) === "WEBP") size = webp(bytes);
  return size && size.width > 0 && size.height > 0 ? size : undefined;
}
