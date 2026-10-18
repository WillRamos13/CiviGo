const test = require("node:test");
const assert = require("node:assert/strict");
const { videoDuration } = require("../src/lib/media");
function mp4(seconds, brand = "mp42") {
  const ftyp = Buffer.alloc(16);
  ftyp.writeUInt32BE(16);
  ftyp.write("ftyp", 4);
  ftyp.write(brand, 8);
  const mvhd = Buffer.alloc(28);
  mvhd.writeUInt32BE(28);
  mvhd.write("mvhd", 4);
  mvhd.writeUInt32BE(1000, 20);
  mvhd.writeUInt32BE(seconds * 1000, 24);
  const moov = Buffer.alloc(8);
  moov.writeUInt32BE(36);
  moov.write("moov", 4);
  return Buffer.concat([ftyp, moov, mvhd]);
}
test("Los videos MP4 conservan duración máxima de treinta segundos", () => {
  assert.equal(videoDuration(mp4(12), "video/mp4"), 12);
  assert.equal(videoDuration(mp4(30), "video/mp4"), 30);
  assert.throws(() => videoDuration(mp4(31), "video/mp4"));
  assert.throws(() => videoDuration(Buffer.from("mp4 falso"), "video/mp4"));
});
test("Los videos WebM leen Duration y rechazan contenedores sin duración", () => {
  const duration = Buffer.alloc(8);
  duration.writeDoubleBE(12000);
  const data = Buffer.concat([Buffer.from([0x44, 0x89, 0x88]), duration]);
  const info = Buffer.concat([
    Buffer.from([0x15, 0x49, 0xa9, 0x66, 0x80 | data.length]),
    data,
  ]);
  const segment = Buffer.concat([
    Buffer.from([0x18, 0x53, 0x80, 0x67, 0x80 | info.length]),
    info,
  ]);
  assert.equal(videoDuration(segment, "video/webm"), 12);
  assert.throws(() =>
    videoDuration(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), "video/webm"),
  );
});

test("Los videos MOV de cámara verifican la marca QuickTime y el límite de duración", () => {
  const { signature } = require("../src/routes/uploads");
  const short = mp4(20, "qt  ");
  assert.equal(signature(short, "video/quicktime"), true);
  assert.equal(signature(mp4(20), "video/quicktime"), false);
  assert.equal(signature(Buffer.from("ftypqt"), "video/quicktime"), false);
  assert.equal(videoDuration(short, "video/quicktime"), 20);
  assert.throws(() => videoDuration(mp4(31, "qt  "), "video/quicktime"));
});

test("Los contenedores MP4 anidados no desbordan la pila ni producen un error interno", () => {
  const depth = 20000;
  const leaf = mp4(12).subarray(24);
  const buffer = Buffer.alloc(16 + depth * 8 + leaf.length);
  mp4(12).copy(buffer, 0, 0, 16);
  for (let index = 0; index < depth; index++) {
    const offset = 16 + index * 8;
    buffer.writeUInt32BE(buffer.length - offset, offset);
    buffer.write("moov", offset + 4);
  }
  leaf.copy(buffer, 16 + depth * 8);
  assert.throws(
    () => videoDuration(buffer, "video/mp4"),
    (error) => error.status === 400 && !(error instanceof RangeError),
  );
  assert.equal(videoDuration(mp4(12), "video/mp4"), 12);
});

test("El análisis MP4 limita las cajas de metadatos de un archivo malformado", () => {
  const boxes = 100001;
  const buffer = Buffer.alloc(16 + boxes * 8 + mp4(12).length - 16);
  mp4(12).copy(buffer, 0, 0, 16);
  for (let index = 0; index < boxes; index++) {
    const offset = 16 + index * 8;
    buffer.writeUInt32BE(8, offset);
    buffer.write("free", offset + 4);
  }
  mp4(12).copy(buffer, 16 + boxes * 8, 16);
  assert.throws(
    () => videoDuration(buffer, "video/mp4"),
    (error) => error.status === 400,
  );
});
