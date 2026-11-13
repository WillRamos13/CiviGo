const test = require("node:test"),
  assert = require("node:assert/strict");
const { sanitizePublicImage, orientation } = require("../src/lib/public-image");
function jpegSegment(marker, payload) {
  const header = Buffer.from([255, marker, 0, 0]);
  header.writeUInt16BE(payload.length + 2, 2);
  return Buffer.concat([header, payload]);
}
test("public JPEG loses GPS/XMP/IPTC/comments while preserving pixels and EXIF orientation", () => {
  const exif = Buffer.alloc(52);
  exif.write("Exif\0\0", 0, "binary");
  exif.write("II", 6);
  exif.writeUInt16LE(42, 8);
  exif.writeUInt32LE(8, 10);
  exif.writeUInt16LE(2, 14);
  exif.writeUInt16LE(0x112, 16);
  exif.writeUInt16LE(3, 18);
  exif.writeUInt32LE(1, 20);
  exif.writeUInt16LE(6, 24);
  exif.write("GPS:PRIVATE", 32);
  const pixels = Buffer.from([255, 218, 0, 2, 12, 33, 44, 255, 217]);
  const source = Buffer.concat([
    Buffer.from([255, 216]),
    jpegSegment(225, exif),
    jpegSegment(225, Buffer.from("http://ns.adobe.com/xap/1.0/ PRIVATE")),
    jpegSegment(237, Buffer.from("IPTC PRIVATE")),
    jpegSegment(254, Buffer.from("camera PRIVATE")),
    pixels,
  ]);
  const before = Buffer.from(source),
    clean = sanitizePublicImage(source, "image/jpeg");
  assert.equal(clean.includes(Buffer.from("PRIVATE")), false);
  assert.equal(clean.includes(Buffer.from("GPS")), false);
  assert.deepEqual(source, before);
  assert.equal(orientation(clean.subarray(6, 38)), 6);
  assert.ok(clean.subarray(-pixels.length).equals(pixels));
});
test("public PNG drops EXIF and textual metadata while retaining image chunks verbatim", () => {
  const header = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const chunk = (name, data) => {
    const p = Buffer.alloc(12 + data.length);
    p.writeUInt32BE(data.length, 0);
    p.write(name, 4);
    data.copy(p, 8);
    return p;
  };
  const image = chunk("IDAT", Buffer.from([7, 8, 9]));
  const source = Buffer.concat([
    header,
    chunk("eXIf", Buffer.from("PRIVATE GPS")),
    chunk("iTXt", Buffer.from("PRIVATE author")),
    image,
    chunk("IEND", Buffer.alloc(0)),
  ]);
  const clean = sanitizePublicImage(source, "image/png");
  assert.equal(clean.includes(Buffer.from("PRIVATE")), false);
  assert.ok(clean.includes(image));
  assert.throws(
    () =>
      sanitizePublicImage(
        Buffer.concat([
          header,
          Buffer.from([255, 255, 255, 255, 65, 65, 65, 65, 0, 0, 0, 0]),
        ]),
        "image/png",
      ),
    /estructura/,
  );
});
test("public WebP removes EXIF/XMP, clears metadata flags and fixes the RIFF size", () => {
  const chunk = (name, data) => {
    const p = Buffer.alloc(8 + data.length + (data.length % 2));
    p.write(name, 0);
    p.writeUInt32LE(data.length, 4);
    data.copy(p, 8);
    return p;
  };
  const header = Buffer.from("RIFF0000WEBP"),
    pixel = chunk("VP8 ", Buffer.from([1, 2, 3]));
  const source = Buffer.concat([
    header,
    chunk("VP8X", Buffer.from([12, 0, 0, 0, 0, 0, 0, 0, 0, 0])),
    chunk("EXIF", Buffer.from("PRIVATE")),
    chunk("XMP ", Buffer.from("PRIVATE")),
    pixel,
  ]);
  source.writeUInt32LE(source.length - 8, 4);
  const clean = sanitizePublicImage(source, "image/webp");
  assert.equal(clean.includes(Buffer.from("PRIVATE")), false);
  assert.equal(clean[20] & 12, 0);
  assert.equal(clean.readUInt32LE(4), clean.length - 8);
  assert.ok(clean.includes(pixel));
});
