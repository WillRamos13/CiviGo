const { DesktopError } = require('./policy.cjs');
const LIMIT = 5 * 1024 * 1024;
function imagePreview(file) {
  const bytes = file?.bytes, mime = file?.mimeType;
  if (!(bytes instanceof Uint8Array) || !bytes.length || bytes.length > LIMIT)
    throw new DesktopError('La imagen debe pesar como máximo 5 MB.', 413);
  const buffer = Buffer.from(bytes);
  const valid = mime === 'image/jpeg' ? buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255
    : mime === 'image/png' ? buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    : mime === 'image/gif' ? /^GIF8[79]a/.test(buffer.subarray(0, 6).toString())
    : mime === 'image/webp' ? buffer.subarray(0, 4).toString() === 'RIFF' && buffer.subarray(8, 12).toString() === 'WEBP'
    : false;
  if (!valid) throw new DesktopError('La vista previa admite únicamente imágenes JPEG, PNG, WebP o GIF válidas.', 400);
  return 'data:' + mime + ';base64,' + buffer.toString('base64');
}
module.exports = { imagePreview };
