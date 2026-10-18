// Builds a .ico file from PNG images. Modern ICO files may hold PNG data directly (Windows Vista and later, all browsers).

/** @param {{ size: number, png: Buffer }[]} images square images, one per size */
export function icoFromPngs(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type 1 = icon
  header.writeUInt16LE(images.length, 4);
  const entries = Buffer.alloc(16 * images.length);
  let offset = header.length + entries.length;
  images.forEach(({ size, png }, i) => {
    const at = i * 16;
    entries.writeUInt8(size >= 256 ? 0 : size, at); // width (0 means 256)
    entries.writeUInt8(size >= 256 ? 0 : size, at + 1); // height
    entries.writeUInt8(0, at + 2); // palette colors
    entries.writeUInt8(0, at + 3); // reserved
    entries.writeUInt16LE(1, at + 4); // color planes
    entries.writeUInt16LE(32, at + 6); // bits per pixel
    entries.writeUInt32LE(png.length, at + 8);
    entries.writeUInt32LE(offset, at + 12);
    offset += png.length;
  });
  return Buffer.concat([header, entries, ...images.map((i) => i.png)]);
}

/** The images listed in an .ico file: width, height, and whether the data is a PNG. */
export function readIco(buffer) {
  if (buffer.readUInt16LE(0) !== 0 || buffer.readUInt16LE(2) !== 1) throw new Error("not an icon file");
  const count = buffer.readUInt16LE(4);
  return Array.from({ length: count }, (_, i) => {
    const at = 6 + i * 16;
    const size = buffer.readUInt32LE(at + 8);
    const offset = buffer.readUInt32LE(at + 12);
    return { width: buffer[at] || 256, height: buffer[at + 1] || 256, bytes: size, png: buffer.subarray(offset, offset + 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) };
  });
}
