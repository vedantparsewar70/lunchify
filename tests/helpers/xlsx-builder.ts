import zlib from 'zlib';

/**
 * Builds a minimal .xlsx (one worksheet, shared strings, merged cells) in memory for tests.
 * rows[0] is spreadsheet row 1; numbers are written as numeric cells, strings as shared strings.
 */
export function buildXlsx(sheetName: string, rows: Array<Array<string | number | null>>, merges: string[] = []): Buffer {
  const strings: string[] = [];
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const col = (i: number) => String.fromCharCode(65 + i);
  const sheetRows = rows
    .map((cells, r) => {
      const xml = cells
        .map((v, c) => {
          const ref = `${col(c)}${r + 1}`;
          if (v === null || v === undefined) return '';
          if (typeof v === 'number') return `<c r="${ref}"><v>${v}</v></c>`;
          strings.push(v);
          return `<c r="${ref}" t="s"><v>${strings.length - 1}</v></c>`;
        })
        .join('');
      return `<row r="${r + 1}">${xml}</row>`;
    })
    .join('');
  const mergeXml = merges.length ? `<mergeCells count="${merges.length}">${merges.map((m) => `<mergeCell ref="${m}"/>`).join('')}</mergeCells>` : '';
  const files: Record<string, string> = {
    '[Content_Types].xml': '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>',
    'xl/workbook.xml': `<?xml version="1.0"?><workbook xmlns:r="r"><sheets><sheet name="${esc(sheetName)}" sheetId="2" r:id="rId1"/></sheets></workbook>`,
    'xl/_rels/workbook.xml.rels': '<?xml version="1.0"?><Relationships><Relationship Id="rId1" Type="worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
    'xl/sharedStrings.xml': `<?xml version="1.0"?><sst>${strings.map((s) => `<si><t xml:space="preserve">${esc(s)}</t></si>`).join('')}</sst>`,
    'xl/worksheets/sheet1.xml': `<?xml version="1.0"?><worksheet><sheetData>${sheetRows}</sheetData>${mergeXml}</worksheet>`,
  };

  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const data = Buffer.from(content, 'utf8');
    const compressed = zlib.deflateRawSync(data);
    const crc = zlib.crc32(data);
    const nameBuf = Buffer.from(name, 'utf8');
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, nameBuf, compressed);
    centrals.push(central, nameBuf);
    offset += 30 + nameBuf.length + compressed.length;
  }
  const centralBuf = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(files).length, 8);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralBuf, end]);
}

/** The supplied November_2026_Menu.xlsx, cell for cell (Excel date serials, merged holiday ranges). */
export function november2026Workbook(): Buffer {
  const D = (day: number) => 46326 + day; // 46327 = 2026-11-01
  const same = (dish: string) => [dish, dish, dish];
  const rows: Array<Array<string | number | null>> = [
    ['November 2026 Brunch Menu'],
    ['Day', 'Date', 'Pre-primary', 'Primary', 'Secondary'],
    ['Sunday', D(1), 'Holiday', null, null],
    ['Monday', D(2), ...same('Soyabean Masala+Dal+Chapati+Salad')],
    ['Tuesday', D(3), ...same('Aloo Gobi + Chapati + Lemon Rice + Papad')],
    ['Wednesday', D(4), ...same('Jeera Rice + Chole Bhaji + Chapati + Salad+Sweet')],
    ['Thursday', D(5), 'Diwali Vacation', null, null],
    ['Friday', D(6)], ['Saturday', D(7)], ['Sunday', D(8)], ['Monday', D(9)], ['Tuesday', D(10)], ['Wednesday', D(11)],
    ['Thursday', D(12)], ['Friday', D(13)], ['Saturday', D(14)], ['Sunday', D(15)], ['Monday', D(16)],
    ['Tuesday', D(17), ...same(' Chana Masala + Chapati +Jeera Rice +  Salad')],
    ['Wednesday', D(18), ...same('Green Moong + Dal + Chapati + Rice')],
    ['Thursday', D(19), ...same('Aloo Paratha + Pulao + Curd')],
    ['Friday', D(20), ...same('Uttapa+Sambar+Chutney')],
    ['Saturday', D(21), 'Holiday', null, null],
    ['Sunday', D(22)],
    ['Monday', D(23), ...same('Bharli Vangi + Pancharatna Dal + Chapati + Rice')],
    ['Tuesday', D(24), 'Guru Nanak Jayanti Holiday', null, null],
    ['Wednesday', D(25), ...same('Paneer butter Masala+Dal+Chapati+Rice')],
    ['Thursday', D(26), 'Veg Cutlet+Mint Chutney+Banana', 'Veg Biryani + Raita + Papad(udid roasted)', 'Veg Biryani + Raita + Papad(udid roasted)'],
    ['Friday', D(27), ...same(' Chawli Usal+Masale Bhat + Chapati + Salad')],
    ['Saturday', D(28), ...same(' Cabbage Peas subji+ Dal +Rice+Chapati + Salad')],
    ['Sunday', D(29), 'Holiday', null, null],
    ['Monday', D(30), ...same('Kofta Curry + Dal + Rice + Chapati + Salad')],
  ];
  return buildXlsx('November 2026', rows, ['C26:E26', 'C31:E31', 'A1:E1', 'C23:E24', 'C7:E18', 'C3:E3']);
}
