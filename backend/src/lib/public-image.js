const { HttpError } = require("./http");
const { crc32 } = require("node:zlib");
const invalid = () =>
  new HttpError(
    400,
    "La estructura de la imagen no es válida. Vuelve a exportarla como JPG, PNG o WebP.",
  );
function orientation(payload) {
  const offset = payload.subarray(0, 6).equals(Buffer.from("Exif\0\0")) ? 6 : 0;
  if (payload.length < offset + 8) return 1;
  const little = payload.toString("ascii", offset, offset + 2) === "II";
  if (!little && payload.toString("ascii", offset, offset + 2) !== "MM")
    return 1;
  const u16 = (p) =>
      little ? payload.readUInt16LE(p) : payload.readUInt16BE(p),
    u32 = (p) => (little ? payload.readUInt32LE(p) : payload.readUInt32BE(p));
  if (u16(offset + 2) !== 42) return 1;
  const directory = offset + u32(offset + 4);
  if (directory < offset + 8 || directory + 2 > payload.length) return 1;
  const count = Math.min(u16(directory), 512);
  for (let i = 0; i < count; i++) {
    const entry = directory + 2 + i * 12;
    if (entry + 12 > payload.length) break;
    if (u16(entry) === 0x112 && u16(entry + 2) === 3 && u32(entry + 4) === 1) {
      const value = u16(entry + 8);
      return value >= 1 && value <= 8 ? value : 1;
    }
  }
  return 1;
}
function orientationOnly(value) {
  const segment = Buffer.alloc(36);
  segment[0] = 255;
  segment[1] = 225;
  segment.writeUInt16BE(34, 2);
  segment.write("Exif\0\0", 4, "binary");
  segment.write("II", 10);
  segment.writeUInt16LE(42, 12);
  segment.writeUInt32LE(8, 14);
  segment.writeUInt16LE(1, 18);
  segment.writeUInt16LE(0x112, 20);
  segment.writeUInt16LE(3, 22);
  segment.writeUInt32LE(1, 24);
  segment.writeUInt16LE(value, 28);
  return segment;
}
function jpeg(buffer) {
  const segments = [buffer.subarray(0, 2)];
  let offset = 2,
    rotation = 1;
  while (offset < buffer.length) {
    const start = offset;
    if (buffer[offset++] !== 255) throw invalid();
    while (buffer[offset] === 255) offset++;
    if (offset >= buffer.length) break;
    const marker = buffer[offset++];
    if (marker === 0xda || marker === 0xd9) {
      segments.push(buffer.subarray(start));
      break;
    }
    if (marker === 1 || (marker >= 0xd0 && marker <= 0xd7)) {
      segments.push(buffer.subarray(start, offset));
      continue;
    }
    if (offset + 2 > buffer.length) throw invalid();
    const length = buffer.readUInt16BE(offset);
    if (length < 2 || offset + length > buffer.length) throw invalid();
    if (marker === 0xe1) {
      rotation =
        orientation(buffer.subarray(offset + 2, offset + length)) !== 1
          ? orientation(buffer.subarray(offset + 2, offset + length))
          : rotation;
    } else if (marker !== 0xed && marker !== 0xfe)
      segments.push(buffer.subarray(start, offset + length));
    offset += length;
  }
  // Orientation is the only retained EXIF tag: pixels and their display rotation stay intact.
  if (rotation !== 1) segments.splice(1, 0, orientationOnly(rotation));
  return Buffer.concat(segments);
}
function png(buffer) {
  const chunks = [buffer.subarray(0, 8)];
  let offset = 8;
  while (offset < buffer.length) {
    if (offset + 12 > buffer.length) throw invalid();
    const length = buffer.readUInt32BE(offset),
      end = offset + 12 + length;
    if (end > buffer.length) throw invalid();
    const type = buffer.toString("ascii", offset + 4, offset + 8);
    if (type === "eXIf") {
      const rotation = orientation(buffer.subarray(offset + 8, end - 4));
      if (rotation !== 1) {
        const data = orientationOnly(rotation).subarray(10),
          chunk = Buffer.alloc(data.length + 12);
        chunk.writeUInt32BE(data.length, 0);
        chunk.write("eXIf", 4);
        data.copy(chunk, 8);
        chunk.writeUInt32BE(crc32(chunk.subarray(4, -4)), chunk.length - 4);
        chunks.push(chunk);
      }
    } else if (!["tEXt", "zTXt", "iTXt"].includes(type))
      chunks.push(buffer.subarray(offset, end));
    offset = end;
  }
  return Buffer.concat(chunks);
}
function webp(buffer) {
  if (buffer.length < 12) throw invalid();
  const chunks = [buffer.subarray(0, 12)];
  let offset = 12,
    hasExif = false;
  while (offset < buffer.length) {
    if (offset + 8 > buffer.length) throw invalid();
    const length = buffer.readUInt32LE(offset + 4),
      end = offset + 8 + length + (length % 2);
    if (end > buffer.length) throw invalid();
    const type = buffer.toString("ascii", offset, offset + 4);
    if (type === "EXIF") {
      const payload = buffer.subarray(offset + 8, offset + 8 + length),
        rotation = orientation(payload);
      if (rotation !== 1) {
        const data = orientationOnly(rotation).subarray(
            payload.subarray(0, 6).equals(Buffer.from("Exif\0\0")) ? 4 : 10,
          ),
          chunk = Buffer.alloc(data.length + 8 + (data.length % 2));
        chunk.write("EXIF", 0);
        chunk.writeUInt32LE(data.length, 4);
        data.copy(chunk, 8);
        chunks.push(chunk);
        hasExif = true;
      }
    } else if (type !== "XMP ") {
      const chunk = Buffer.from(buffer.subarray(offset, end));
      chunks.push(chunk);
    }
    offset = end;
  }
  for (const chunk of chunks.slice(1))
    if (chunk.toString("ascii", 0, 4) === "VP8X" && chunk.length >= 9)
      chunk[8] = (chunk[8] & ~0x0c) | (hasExif ? 8 : 0);
  const result = Buffer.concat(chunks);
  result.writeUInt32LE(result.length - 8, 4);
  return result;
}
/** Lossless metadata removal for public photos; private originals never enter here. */
function sanitizePublicImage(buffer, mime) {
  if (mime === "image/jpeg") return jpeg(buffer);
  if (mime === "image/png") return png(buffer);
  if (mime === "image/webp") return webp(buffer);
  return buffer;
}
module.exports = { sanitizePublicImage, orientation };
