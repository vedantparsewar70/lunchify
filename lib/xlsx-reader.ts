import zlib from 'zlib';

/**
 * Minimal, dependency-free reader for the first worksheet of an .xlsx file (Office Open XML).
 * Reads cell values exactly as stored (shared strings, inline strings, numbers) and the merged
 * cell ranges. Formulas are not evaluated (their cached value is used). Defensive limits guard
 * against oversized or malicious uploads.
 */

export const MAX_XLSX_BYTES = 2 * 1024 * 1024;
const MAX_ENTRY_BYTES = 8 * 1024 * 1024;
const MAX_ENTRIES = 500;

export interface XlsxSheet {
  name: string;
  /** cells[row][col] with 1-based row and 0-based column (A = 0). */
  cells: Map<number, Map<number, string | number>>;
  merges: Array<{ fromRow: number; fromCol: number; toRow: number; toCol: number }>;
}

export class XlsxError extends Error {}

function readZipEntries(buf: Buffer, wanted: (name: string) => boolean): Map<string, Buffer> {
  // End of central directory record (search the last 64 KiB + 22 bytes).
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new XlsxError('Not a valid .xlsx file (zip directory not found).');

  const count = buf.readUInt16LE(eocd + 10);
  if (count > MAX_ENTRIES) throw new XlsxError('The file has too many parts to be a menu spreadsheet.');
  let offset = buf.readUInt32LE(eocd + 16);
  const out = new Map<string, Buffer>();

  for (let i = 0; i < count; i++) {
    if (offset + 46 > buf.length || buf.readUInt32LE(offset) !== 0x02014b50) {
      throw new XlsxError('The spreadsheet file is damaged.');
    }
    const method = buf.readUInt16LE(offset + 10);
    const compressedSize = buf.readUInt32LE(offset + 20);
    const uncompressedSize = buf.readUInt32LE(offset + 24);
    const nameLen = buf.readUInt16LE(offset + 28);
    const extraLen = buf.readUInt16LE(offset + 30);
    const commentLen = buf.readUInt16LE(offset + 32);
    const localOffset = buf.readUInt32LE(offset + 42);
    const name = buf.subarray(offset + 46, offset + 46 + nameLen).toString('utf8');
    offset += 46 + nameLen + extraLen + commentLen;

    if (!wanted(name)) continue;
    if (uncompressedSize > MAX_ENTRY_BYTES) throw new XlsxError('The spreadsheet is too large.');
    if (localOffset + 30 > buf.length || buf.readUInt32LE(localOffset) !== 0x04034b50) {
      throw new XlsxError('The spreadsheet file is damaged.');
    }
    const dataStart = localOffset + 30 + buf.readUInt16LE(localOffset + 26) + buf.readUInt16LE(localOffset + 28);
    const data = buf.subarray(dataStart, dataStart + compressedSize);
    if (method === 0) out.set(name, Buffer.from(data));
    else if (method === 8) out.set(name, zlib.inflateRawSync(data, { maxOutputLength: MAX_ENTRY_BYTES }));
    else throw new XlsxError('Unsupported compression in spreadsheet.');
  }
  return out;
}

export function decodeXmlText(text: string): string {
  return text
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

/** Concatenates every <t> run inside an element (rich text cells have several). */
function textRuns(xml: string): string {
  let text = '';
  for (const m of xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)) text += decodeXmlText(m[1]);
  return text;
}

export function columnIndex(letters: string): number {
  let n = 0;
  for (const ch of letters.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function parseRef(ref: string): { row: number; col: number } {
  const m = /^([A-Z]+)(\d+)$/i.exec(ref);
  if (!m) throw new XlsxError(`Invalid cell reference ${ref}`);
  return { col: columnIndex(m[1]), row: parseInt(m[2], 10) };
}

export function readFirstSheet(buf: Buffer): XlsxSheet {
  if (!Buffer.isBuffer(buf) || buf.length < 22) throw new XlsxError('Please upload an .xlsx spreadsheet.');
  if (buf.length > MAX_XLSX_BYTES) throw new XlsxError('The spreadsheet is larger than 2 MB.');

  const parts = readZipEntries(buf, (n) =>
    n === 'xl/workbook.xml' || n === 'xl/_rels/workbook.xml.rels' || n === 'xl/sharedStrings.xml' || /^xl\/worksheets\/[^/]+\.xml$/.test(n)
  );
  const workbook = parts.get('xl/workbook.xml')?.toString('utf8');
  if (!workbook) throw new XlsxError('Not a valid .xlsx file (workbook missing).');

  const firstSheet = /<sheet\s[^>]*?name="([^"]*)"[^>]*?r:id="([^"]+)"/.exec(workbook);
  let sheetPath = 'xl/worksheets/sheet1.xml';
  if (firstSheet) {
    const rels = parts.get('xl/_rels/workbook.xml.rels')?.toString('utf8') || '';
    const rel = new RegExp(`<Relationship\\s[^>]*?Id="${firstSheet[2]}"[^>]*?Target="([^"]+)"`).exec(rels)
      || new RegExp(`<Relationship\\s[^>]*?Target="([^"]+)"[^>]*?Id="${firstSheet[2]}"`).exec(rels);
    if (rel) sheetPath = rel[1].startsWith('/') ? rel[1].slice(1) : `xl/${rel[1].replace(/^\.\//, '')}`;
  }
  const sheetXml = parts.get(sheetPath)?.toString('utf8');
  if (!sheetXml) throw new XlsxError('The first worksheet could not be read.');

  const shared: string[] = [];
  const sst = parts.get('xl/sharedStrings.xml')?.toString('utf8') || '';
  for (const si of sst.matchAll(/<si>([\s\S]*?)<\/si>/g)) shared.push(textRuns(si[1]));

  const cells = new Map<number, Map<number, string | number>>();
  for (const c of sheetXml.matchAll(/<c\s([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
    const attrs = c[1];
    const body = c[2] || '';
    const ref = /\br="([A-Z]+\d+)"/i.exec(attrs)?.[1];
    if (!ref) continue;
    const type = /\bt="([^"]+)"/.exec(attrs)?.[1];
    const raw = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
    let value: string | number | undefined;
    if (type === 's' && raw !== undefined) value = shared[parseInt(raw, 10)] ?? '';
    else if (type === 'inlineStr') value = textRuns(body);
    else if (type === 'str' || type === 'e') value = raw !== undefined ? decodeXmlText(raw) : undefined;
    else if (type === 'b') value = raw === '1' ? 'TRUE' : 'FALSE';
    else if (raw !== undefined && raw !== '') value = Number(raw);
    if (value === undefined || value === '') continue;
    const { row, col } = parseRef(ref);
    if (!cells.has(row)) cells.set(row, new Map());
    cells.get(row)!.set(col, value);
  }

  const merges: XlsxSheet['merges'] = [];
  for (const m of sheetXml.matchAll(/<mergeCell\s[^>]*?ref="([A-Z]+\d+):([A-Z]+\d+)"/gi)) {
    const from = parseRef(m[1]);
    const to = parseRef(m[2]);
    merges.push({ fromRow: from.row, fromCol: from.col, toRow: to.row, toCol: to.col });
  }

  return { name: firstSheet ? decodeXmlText(firstSheet[1]) : 'Sheet1', cells, merges };
}
