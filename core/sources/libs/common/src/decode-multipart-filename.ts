/**
 * Multer/busboy reads multipart `filename` as Latin-1, but browsers send UTF-8 bytes.
 * Re-decode when every non-ASCII code point fits in a single byte (typical mojibake).
 */
export function decodeMultipartFilename(filename: string): string {
  if (!filename || !/[^\x00-\x7f]/.test(filename)) {
    return filename;
  }

  // Already proper Unicode (e.g. CJK) — busboy decoded UTF-8 correctly.
  if ([...filename].some((ch) => ch.charCodeAt(0) > 0xff)) {
    return filename;
  }

  const decoded = Buffer.from(filename, 'latin1').toString('utf8');
  return decoded.includes('\uFFFD') ? filename : decoded;
}
