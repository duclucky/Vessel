import { serializeNftMetadata } from './metadata-schema.js';

const encoder = new TextEncoder();
const ZIP_UTF8_FLAG = 0x0800;
const ZIP_STORED_METHOD = 0;
const ZIP_DOS_DATE_1980_01_01 = 33;
export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
    }
    table[index] = value >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC32_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function concatBytes(parts) {
  const size = parts.reduce((sum, part) => sum + part.length, 0);
  const output = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}

function zipError(message, code, details = {}) {
  return Object.assign(new Error(message), { code, ...details });
}

function normalizeZipPath(value) {
  const source = String(value || '').replaceAll('\\', '/');
  if (!source || source.startsWith('/') || /^[a-z]:/i.test(source)) {
    throw zipError('ZIP entry path must be relative', 'zip_path_invalid', { path: source });
  }
  const segments = source.split('/');
  if (segments.some((segment) => !segment || segment === '.' || segment === '..')) {
    throw zipError('ZIP entry path contains an unsafe segment', 'zip_path_invalid', { path: source });
  }
  return segments.join('/');
}

function localHeader(entry) {
  const header = new Uint8Array(30);
  const view = new DataView(header.buffer);
  view.setUint32(0, 0x04034b50, true);
  view.setUint16(4, 20, true);
  view.setUint16(6, ZIP_UTF8_FLAG, true);
  view.setUint16(8, ZIP_STORED_METHOD, true);
  view.setUint16(10, 0, true);
  view.setUint16(12, ZIP_DOS_DATE_1980_01_01, true);
  view.setUint32(14, entry.crc, true);
  view.setUint32(18, entry.data.length, true);
  view.setUint32(22, entry.data.length, true);
  view.setUint16(26, entry.nameBytes.length, true);
  view.setUint16(28, 0, true);
  return header;
}

function centralHeader(entry) {
  const header = new Uint8Array(46);
  const view = new DataView(header.buffer);
  view.setUint32(0, 0x02014b50, true);
  view.setUint16(4, 20, true);
  view.setUint16(6, 20, true);
  view.setUint16(8, ZIP_UTF8_FLAG, true);
  view.setUint16(10, ZIP_STORED_METHOD, true);
  view.setUint16(12, 0, true);
  view.setUint16(14, ZIP_DOS_DATE_1980_01_01, true);
  view.setUint32(16, entry.crc, true);
  view.setUint32(20, entry.data.length, true);
  view.setUint32(24, entry.data.length, true);
  view.setUint16(28, entry.nameBytes.length, true);
  view.setUint16(30, 0, true);
  view.setUint16(32, 0, true);
  view.setUint16(34, 0, true);
  view.setUint16(36, 0, true);
  view.setUint32(38, 0, true);
  view.setUint32(42, entry.localOffset, true);
  return header;
}

function endOfCentralDirectory(entryCount, centralSize, centralOffset) {
  const record = new Uint8Array(22);
  const view = new DataView(record.buffer);
  view.setUint32(0, 0x06054b50, true);
  view.setUint16(4, 0, true);
  view.setUint16(6, 0, true);
  view.setUint16(8, entryCount, true);
  view.setUint16(10, entryCount, true);
  view.setUint32(12, centralSize, true);
  view.setUint32(16, centralOffset, true);
  view.setUint16(20, 0, true);
  return record;
}

function basename(value) {
  return String(value || '').replaceAll('\\', '/').split('/').pop() || '';
}

function hostedUrl(result) {
  return String(result?.url || result?.tokenUri || '').trim();
}

function safeWarnings(input) {
  if (!Array.isArray(input)) return [];
  return input.map((entry) => {
    const rawPath = String(entry?.path || '');
    const path = basename(rawPath);
    const rawMessage = String(entry?.message || entry?.code || 'Warning');
    const message = rawPath ? rawMessage.split(rawPath).join(path) : rawMessage;
    return Object.freeze({
      code: String(entry?.code || 'warning'),
      path,
      message,
    });
  });
}

function makeEntry(path, content) {
  const name = normalizeZipPath(path);
  const data = encoder.encode(String(content));
  if (data.length > 0xffffffff) throw zipError('ZIP entry is too large', 'zip_entry_too_large', { path: name });
  const nameBytes = encoder.encode(name);
  return { name, nameBytes, data, crc: crc32(data), localOffset: 0 };
}

function zipEntries(entries, type = 'application/zip') {
  if (entries.length > 0xffff) throw zipError('ZIP contains too many entries', 'zip_entry_limit');
  const seen = new Set();
  for (const entry of entries) {
    const key = entry.name.toLowerCase();
    if (seen.has(key)) throw zipError('ZIP contains a duplicate entry path', 'zip_path_duplicate', { path: entry.name });
    seen.add(key);
  }

  const localParts = [];
  let localOffset = 0;
  for (const entry of entries) {
    entry.localOffset = localOffset;
    const parts = [localHeader(entry), entry.nameBytes, entry.data];
    localParts.push(...parts);
    localOffset += parts.reduce((sum, part) => sum + part.length, 0);
  }
  const centralParts = entries.flatMap((entry) => [centralHeader(entry), entry.nameBytes]);
  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
  const bytes = concatBytes([
    ...localParts,
    ...centralParts,
    endOfCentralDirectory(entries.length, centralSize, localOffset),
  ]);
  return new Blob([bytes], { type });
}

function xmlEscape(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;',
  })[char]);
}

function columnName(index) {
  let value = index + 1;
  let name = '';
  while (value > 0) {
    const remainder = (value - 1) % 26;
    name = String.fromCharCode(65 + remainder) + name;
    value = Math.floor((value - 1) / 26);
  }
  return name;
}

function sheetName(value) {
  return String(value || 'Vessel Manifest').replace(/[\][:*?/\\]/g, ' ').slice(0, 31) || 'Vessel Manifest';
}

function columnWidth(header) {
  const text = String(header || '');
  if (/URL|TokenURI|Proof/i.test(text)) return 44;
  if (/Path/i.test(text)) return 34;
  if (/File Name/i.test(text)) return 28;
  if (/Folder|Collection/i.test(text)) return 24;
  if (/Status|Size|Type/i.test(text)) return 16;
  return 22;
}

function cellXml(value, rowIndex, columnIndex) {
  const ref = `${columnName(columnIndex)}${rowIndex + 1}`;
  const style = rowIndex === 0 ? 1 : 2;
  const text = xmlEscape(value);
  const preserve = /^\s|\s$|\n/.test(String(value ?? '')) ? ' xml:space="preserve"' : '';
  return `<c r="${ref}" t="inlineStr" s="${style}"><is><t${preserve}>${text}</t></is></c>`;
}

function worksheetXml(rows) {
  const safeRows = Array.isArray(rows) && rows.length ? rows : [['Vessel Manifest']];
  const columnCount = Math.max(...safeRows.map((row) => row.length));
  const header = safeRows[0] || [];
  const cols = Array.from({ length: columnCount }, (_, index) => {
    const width = columnWidth(header[index]);
    return `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`;
  }).join('');
  const sheetData = safeRows.map((row, rowIndex) => {
    const cells = Array.from({ length: columnCount }, (_, columnIndex) => cellXml(row[columnIndex] ?? '', rowIndex, columnIndex)).join('');
    const height = rowIndex === 0 ? ' ht="24" customHeight="1"' : '';
    return `<row r="${rowIndex + 1}"${height}>${cells}</row>`;
  }).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
  <cols>${cols}</cols>
  <sheetData>${sheetData}</sheetData>
</worksheet>`;
}

function stylesXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="2">
    <font><sz val="11"/><color rgb="FFE2E8F0"/><name val="Calibri"/></font>
    <font><b/><sz val="14"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>
  </fonts>
  <fills count="3">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FF22D3EE"/><bgColor indexed="64"/></patternFill></fill>
  </fills>
  <borders count="2">
    <border><left/><right/><top/><bottom/><diagonal/></border>
    <border><left style="thin"><color rgb="FFCBD5E1"/></left><right style="thin"><color rgb="FFCBD5E1"/></right><top style="thin"><color rgb="FFCBD5E1"/></top><bottom style="thin"><color rgb="FFCBD5E1"/></bottom><diagonal/></border>
  </borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="3">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
    <xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
  </cellXfs>
  <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;
}

export function buildStyledWorkbook(rows, { name = 'Vessel Manifest' } = {}) {
  const safeName = sheetName(name);
  return zipEntries([
    makeEntry('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>`),
    makeEntry('_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`),
    makeEntry('xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets><sheet name="${xmlEscape(safeName)}" sheetId="1" r:id="rId1"/></sheets>
</workbook>`),
    makeEntry('xl/_rels/workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`),
    makeEntry('xl/styles.xml', stylesXml()),
    makeEntry('xl/worksheets/sheet1.xml', worksheetXml(rows)),
  ], XLSX_MIME);
}

export function metadataJsonFile(metadata, fileName = 'metadata.json') {
  return new File([serializeNftMetadata(metadata)], fileName, { type: 'application/json' });
}

export function buildCollectionManifest(items, hostedResults = [], {
  collectionName = '',
} = {}) {
  const resultsByPath = new Map();
  for (const result of hostedResults || []) {
    const path = String(result?.sourcePath || result?.metadataPath || result?.path || '').replaceAll('\\', '/');
    if (path) resultsByPath.set(path, result);
  }

  const rows = (items || []).map((item) => {
    const metadataPath = String(item?.outputPath || '').replaceAll('\\', '/');
    const result = resultsByPath.get(metadataPath) || resultsByPath.get(basename(metadataPath));
    return Object.freeze({
      collection: String(collectionName || ''),
      itemName: String(item?.metadata?.name || ''),
      sourcePath: String(item?.sourcePath || ''),
      imageUrl: String(item?.metadata?.image || ''),
      metadataPath,
      metadataUrl: hostedUrl(result),
    });
  });
  const tokenUris = rows.map((row) => row.metadataUrl).filter(Boolean);
  const workbookRows = [
    ['🖼 File Name', '📁 Collection', '🔗 Media URL', '🧾 TokenURI', '📂 Source Path', '🧬 Metadata Path'],
    ...rows.map((row) => [
      row.itemName,
      row.collection,
      row.imageUrl,
      row.metadataUrl,
      row.sourcePath,
      row.metadataPath,
    ]),
  ];

  return Object.freeze({
    collectionName: String(collectionName || ''),
    rows: Object.freeze(rows),
    tokenUris: Object.freeze(tokenUris),
    copyText: tokenUris.length ? `${tokenUris.join('\n')}\n` : '',
    workbook: buildStyledWorkbook(workbookRows, { name: 'Collection TokenURIs' }),
  });
}

export async function buildMetadataZip(items, report = {}) {
  const entries = [...(items || [])]
    .map((item) => makeEntry(item.outputPath, item.serialized))
    .sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0));
  const warnings = safeWarnings(report.warnings);
  entries.push(makeEntry('metadata-report.json', `${JSON.stringify({
    generated: entries.length,
    warningCount: warnings.length,
    warnings,
  }, null, 2)}\n`));

  return zipEntries(entries, 'application/zip');
}

export function downloadBlob(blob, fileName, document = globalThis.document) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.hidden = true;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
