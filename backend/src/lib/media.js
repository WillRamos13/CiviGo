const { HttpError } = require("./http");
function mp4Duration(buffer) {
  function boxes(start, end) {
    let offset = start;
    while (offset + 8 <= end) {
      let size = buffer.readUInt32BE(offset),
        header = 8;
      const type = buffer.toString("ascii", offset + 4, offset + 8);
      if (size === 1) {
        if (offset + 16 > end) return null;
        size = Number(buffer.readBigUInt64BE(offset + 8));
        header = 16;
      }
      if (size === 0) size = end - offset;
      if (size < header || offset + size > end) return null;
      const data = offset + header;
      if (type === "mvhd") {
        const version = buffer[data];
        if (version === 0 && size - header >= 20) {
          const scale = buffer.readUInt32BE(data + 12),
            duration = buffer.readUInt32BE(data + 16);
          return scale ? duration / scale : null;
        }
        if (version === 1 && size - header >= 32) {
          const scale = buffer.readUInt32BE(data + 20),
            duration = Number(buffer.readBigUInt64BE(data + 24));
          return scale ? duration / scale : null;
        }
      }
      if (type === "moov") {
        const value = boxes(data, offset + size);
        if (value !== null) return value;
      }
      offset += size;
    }
    return null;
  }
  return boxes(0, buffer.length);
}
function vint(buffer, offset, id = false) {
  const first = buffer[offset];
  if (!first) return null;
  let mask = 128,
    length = 1;
  while (!(first & mask) && length <= 8) {
    mask >>= 1;
    length++;
  }
  if (length > 8 || offset + length > buffer.length) return null;
  let value = id ? first : first & (mask - 1);
  for (let i = 1; i < length; i++) value = value * 256 + buffer[offset + i];
  return { length, value, unknown: !id && value === 2 ** (7 * length) - 1 };
}
function webmDuration(buffer) {
  let duration = null,
    scale = 1000000;
  function parse(start, end, depth = 0) {
    if (depth > 3) return;
    let offset = start;
    while (offset < end) {
      const tag = vint(buffer, offset, true);
      if (!tag || tag.length > 4) return;
      const size = vint(buffer, offset + tag.length);
      if (!size) return;
      const data = offset + tag.length + size.length,
        limit = size.unknown ? end : data + size.value;
      if (limit > end || limit < data) return;
      if (tag.value === 0x18538067 || tag.value === 0x1549a966)
        parse(data, limit, depth + 1);
      if (tag.value === 0x4489) {
        if (size.value === 4) duration = buffer.readFloatBE(data);
        else if (size.value === 8) duration = buffer.readDoubleBE(data);
      }
      if (tag.value === 0x2ad7b1 && size.value <= 6) {
        let value = 0;
        for (let p = data; p < limit; p++) value = value * 256 + buffer[p];
        scale = value;
      }
      offset = limit;
    }
  }
  parse(0, buffer.length);
  return duration === null ? null : (duration * scale) / 1e9;
}
function videoDuration(buffer, mime) {
  const seconds =
    mime === "video/mp4" || mime === "video/quicktime"
      ? mp4Duration(buffer)
      : mime === "video/webm"
        ? webmDuration(buffer)
        : null;
  if (seconds === null || !Number.isFinite(seconds) || seconds <= 0)
    throw new HttpError(
      400,
      "No se pudo verificar la duración del video. Graba un video MP4, MOV o WebM con duración disponible.",
    );
  if (seconds > 30)
    throw new HttpError(400, "Los videos deben durar como máximo 30 segundos.");
  return seconds;
}
module.exports = { mp4Duration, webmDuration, videoDuration };
