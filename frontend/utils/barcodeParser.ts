/**
 * Bộ giải mã mã vạch & mã QR thông minh (Smart Barcode & QR Parser)
 * Hỗ trợ tự động bóc tách Serial, Model/SKU, Số Lô từ các tem phức hợp của hãng Solar (Sungrow, Huawei, Growatt, Deye...)
 * và chuẩn mã vạch công nghiệp GS1 Application Identifiers.
 */

export interface ParsedBarcodeResult {
  /** Chuỗi gốc quét được từ Camera hoặc Súng quét */
  raw: string;
  /** Số Serial thiết bị đã được bóc tách và làm sạch */
  serial: string;
  /** Mã sản phẩm / SKU trích xuất được (nếu có) */
  sku?: string;
  /** Mã Model trích xuất được (nếu có) */
  model?: string;
  /** Số Lô trích xuất được (nếu có) */
  lot?: string;
  /** Hãng hoặc chuẩn mã phát hiện được */
  format?: 'sungrow' | 'huawei' | 'growatt' | 'deye' | 'gs1' | 'url' | 'generic';
}

/**
 * Làm sạch chuỗi quét, loại bỏ các ký tự điều khiển (Control chars ASCII 0-31 như GS, RS, US, CR, LF)
 */
export function cleanRawCode(input: string): string {
  if (!input) return '';
  // Loại bỏ các ký tự điều khiển ASCII vô hình, giữ lại \t, \n, \r để hỗ trợ tách dòng
  return input.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '').trim();
}

/**
 * Trích xuất tham số từ URL nếu mã QR là đường link web kiểm tra xuất xứ của hãng
 */
function parseUrlCode(urlStr: string): ParsedBarcodeResult | null {
  try {
    const url = new URL(urlStr);
    const snParam =
      url.searchParams.get('sn') ||
      url.searchParams.get('SN') ||
      url.searchParams.get('serial') ||
      url.searchParams.get('Serial') ||
      url.searchParams.get('s') ||
      url.searchParams.get('barcode');

    const modelParam =
      url.searchParams.get('model') ||
      url.searchParams.get('pn') ||
      url.searchParams.get('sku');

    let hostFormat: ParsedBarcodeResult['format'] = 'url';
    if (url.hostname.includes('sungrow')) hostFormat = 'sungrow';
    if (url.hostname.includes('huawei')) hostFormat = 'huawei';
    if (url.hostname.includes('growatt')) hostFormat = 'growatt';
    if (url.hostname.includes('deye')) hostFormat = 'deye';

    if (snParam) {
      return {
        raw: urlStr,
        serial: snParam.trim(),
        sku: modelParam?.trim() || undefined,
        format: hostFormat,
      };
    }

    // Nếu không có param trên query string, kiểm tra phân đoạn cuối của pathname
    const segments = url.pathname.split('/').filter(Boolean);
    if (segments.length > 0) {
      const lastSeg = segments[segments.length - 1];
      // Nếu phân đoạn cuối là chuỗi alphanumeric dài từ 6 ký tự trở lên
      if (/^[A-Za-z0-9_-]{6,32}$/.test(lastSeg)) {
        return {
          raw: urlStr,
          serial: lastSeg,
          format: hostFormat,
        };
      }
    }
  } catch {
    // Không phải URL hợp lệ
  }
  return null;
}

/**
 * Bóc tách mã theo chuẩn GS1 Application Identifiers (AI) dạng đóng mở ngoặc hoặc chuỗi liên tục
 * Ví dụ: (01)08935000000001(21)SN12345678(10)LOT2024A
 */
function parseGs1Code(raw: string): ParsedBarcodeResult | null {
  // Dạng có ngoặc đơn rõ ràng: (01)...(21)...
  if (raw.includes('(01)') || raw.includes('(21)') || raw.includes('(10)')) {
    const gtinMatch = raw.match(/\(01\)(\d{14})/);
    const serialMatch = raw.match(/\(21\)([^()]+)/);
    const lotMatch = raw.match(/\(10\)([^()]+)/);

    if (serialMatch || gtinMatch) {
      return {
        raw,
        serial: (serialMatch ? serialMatch[1].trim() : (gtinMatch ? gtinMatch[1].trim() : raw)),
        sku: gtinMatch ? gtinMatch[1].trim() : undefined,
        lot: lotMatch ? lotMatch[1].trim() : undefined,
        format: 'gs1',
      };
    }
  }

  // Dạng GS1 DataMatrix không ngoặc: 01 + 14 digits + 21 + serial
  const gs1LinearMatch = raw.match(/^01(\d{14})21([A-Za-z0-9_-]+)/);
  if (gs1LinearMatch) {
    return {
      raw,
      sku: gs1LinearMatch[1],
      serial: gs1LinearMatch[2],
      format: 'gs1',
    };
  }

  return null;
}

/**
 * Bóc tách danh sách Key-Value dạng phân cách:
 * Phân cách bằng dấu chấm phẩy (;), sổ đứng (|), tab (\t), hoặc xuống dòng (\n)
 * Ví dụ:
 * - "SN=SG110CX2100012345;PN=SG110CX;MD=..."
 * - "Model:SUN2000-100KTL-M1|SN:210107384910M1234567|Date:2024-05"
 * - "S/N: 20241024001\nModel: Deye-SUN-5K"
 */
function parseKeyValueDelimited(raw: string): ParsedBarcodeResult | null {
  // Kiểm tra xem chuỗi có chứa các dấu phân cách phổ biến và cặp key-val không
  const hasDelimiter = raw.includes(';') || raw.includes('|') || raw.includes('\n') || raw.includes('\t');
  const hasAssign = raw.includes('=') || raw.includes(':');

  if (!hasAssign && !hasDelimiter) return null;

  const entries: Record<string, string> = {};
  const tokens = raw.split(/[;|\n\t\r]+/).map((s) => s.trim()).filter(Boolean);

  for (const token of tokens) {
    let key = '';
    let val = '';
    const colonIdx = token.indexOf(':');
    const eqIdx = token.indexOf('=');

    if (eqIdx !== -1 && (colonIdx === -1 || eqIdx < colonIdx)) {
      key = token.slice(0, eqIdx).trim().toUpperCase();
      val = token.slice(eqIdx + 1).trim();
    } else if (colonIdx !== -1) {
      key = token.slice(0, colonIdx).trim().toUpperCase();
      val = token.slice(colonIdx + 1).trim();
    }

    if (key && val) {
      entries[key] = val;
    }
  }

  // Tìm kiếm key serial
  const serialKeys = ['SN', 'SERIAL', 'S/N', 'SERIES', 'SER', 'MÃ SN', 'SO MAY', 'SỐ MÁY'];
  let foundSerial = '';
  for (const k of serialKeys) {
    if (entries[k]) {
      foundSerial = entries[k];
      break;
    }
  }

  // Tìm kiếm key model / SKU / product code
  const skuKeys = ['PN', 'P/N', 'MODEL', 'MOD', 'SKU', 'PART', 'MÃ', 'MA SP'];
  let foundSku = '';
  for (const k of skuKeys) {
    if (entries[k]) {
      foundSku = entries[k];
      break;
    }
  }

  // Tìm kiếm số lô
  const lotKeys = ['LOT', 'BATCH', 'LÔ', 'SO LO', 'SỐ LÔ'];
  let foundLot = '';
  for (const k of lotKeys) {
    if (entries[k]) {
      foundLot = entries[k];
      break;
    }
  }

  if (foundSerial) {
    let detectedFormat: ParsedBarcodeResult['format'] = 'generic';
    const upperRaw = raw.toUpperCase();
    if (upperRaw.includes('DEYE') || (foundSku && foundSku.toUpperCase().includes('SUN-'))) {
      detectedFormat = 'deye';
    } else if (upperRaw.includes('HUAWEI') || foundSerial.startsWith('2101') || (foundSku && /^SUN\d/i.test(foundSku))) {
      detectedFormat = 'huawei';
    } else if (upperRaw.includes('SUNGROW') || foundSerial.startsWith('SG')) {
      detectedFormat = 'sungrow';
    } else if (upperRaw.includes('GROWATT') || (foundSku && foundSku.toUpperCase().startsWith('MIN'))) {
      detectedFormat = 'growatt';
    }

    return {
      raw,
      serial: foundSerial,
      sku: foundSku || undefined,
      model: foundSku || undefined,
      lot: foundLot || undefined,
      format: detectedFormat,
    };
  }

  return null;
}

/**
 * Hàm phân tích chính (Main entry point):
 * Tự động nhận diện và bóc tách chuỗi mã vạch / QR bất kỳ thành Serial sạch & SKU
 */
export function parseBarcodeData(rawInput: string): ParsedBarcodeResult {
  const clean = cleanRawCode(rawInput);
  if (!clean) {
    return { raw: rawInput, serial: '', format: 'generic' };
  }

  // 1. Kiểm tra định dạng URL (các hãng hay in QR là link bảo hành)
  if (clean.startsWith('http://') || clean.startsWith('https://')) {
    const urlRes = parseUrlCode(clean);
    if (urlRes) return urlRes;
  }

  // 2. Kiểm tra chuẩn GS1
  const gs1Res = parseGs1Code(clean);
  if (gs1Res) return gs1Res;

  // 3. Kiểm tra Key-Value phân cách (Sungrow, Huawei, Deye, Solis, v.v.)
  const kvRes = parseKeyValueDelimited(clean);
  if (kvRes) return kvRes;

  // 4. Kiểm tra các tiền tố đơn lẻ phổ biến: "SN: ABC123" hoặc "S/N: ABC123"
  const prefixMatch = clean.match(/^(?:SN|S\/N|SERIAL|SO MAY|MÃ SN)\s*[:=]\s*(.+)$/i);
  if (prefixMatch && prefixMatch[1]) {
    return {
      raw: rawInput,
      serial: prefixMatch[1].trim(),
      format: 'generic',
    };
  }

  // 5. Fallback: Chuỗi thuần không có tiền tố phức tạp (Mã vạch Code 128 tiêu chuẩn)
  return {
    raw: rawInput,
    serial: clean.replace(/[\r\n\t]+/g, ' ').trim(),
    format: 'generic',
  };
}
