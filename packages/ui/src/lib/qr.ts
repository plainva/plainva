import qrcode from "qrcode-generator";

/**
 * Build the module matrix for a QR code, entirely offline (qrcode-generator, no
 * network, no CDN). Returns a square boolean grid (true = dark module) or null
 * when the value is empty or cannot be encoded. Byte mode + medium error
 * correction; type number 0 auto-selects the smallest version that fits, which
 * covers the few-hundred-ASCII-character invitation and device-pairing codes.
 */
export function qrMatrix(value: string): boolean[][] | null {
  if (!value) return null;
  try {
    const qr = qrcode(0, "M");
    qr.addData(value);
    qr.make();
    const n = qr.getModuleCount();
    const grid: boolean[][] = [];
    for (let r = 0; r < n; r++) {
      const row: boolean[] = [];
      for (let c = 0; c < n; c++) row.push(qr.isDark(r, c));
      grid.push(row);
    }
    return grid;
  } catch {
    return null;
  }
}
