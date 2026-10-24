import { describe, it, expect } from 'vitest';
import { parseBarcodeData, cleanRawCode } from '../utils/barcodeParser';

describe('Smart Barcode & QR Parser', () => {
  it('cleans invisible control characters and whitespace', () => {
    const raw = '\x1d  INV-2024-TEST \r\n';
    expect(cleanRawCode(raw)).toBe('INV-2024-TEST');
  });

  it('parses Sungrow QR format with semicolon delimiters', () => {
    const raw = 'SN=SG110CX2100012345;PN=SG110CX;TYPE=INVERTER';
    const res = parseBarcodeData(raw);
    expect(res.serial).toBe('SG110CX2100012345');
    expect(res.sku).toBe('SG110CX');
    expect(res.format).toBe('sungrow');
  });

  it('parses Huawei QR format with pipe delimiter', () => {
    const raw = 'Model:SUN2000-100KTL-M1|SN:210107384910M1234567|Date:2024-05';
    const res = parseBarcodeData(raw);
    expect(res.serial).toBe('210107384910M1234567');
    expect(res.sku).toBe('SUN2000-100KTL-M1');
    expect(res.format).toBe('huawei');
  });

  it('parses Deye multiline format', () => {
    const raw = "S/N: 241024009871\nModel: SUN-5K-SG04LP1\nLot: BATCH-2024-10";
    const res = parseBarcodeData(raw);
    expect(res.serial).toBe('241024009871');
    expect(res.sku).toBe('SUN-5K-SG04LP1');
    expect(res.lot).toBe('BATCH-2024-10');
    expect(res.format).toBe('deye');
  });

  it('parses GS1 Application Identifiers with parentheses', () => {
    const raw = '(01)08935000000001(21)SN9876543210(10)LOT2024A';
    const res = parseBarcodeData(raw);
    expect(res.serial).toBe('SN9876543210');
    expect(res.sku).toBe('08935000000001');
    expect(res.lot).toBe('LOT2024A');
    expect(res.format).toBe('gs1');
  });

  it('parses URL with query parameter', () => {
    const raw = 'https://support.huawei.com/device/verify?sn=2101073849100001&model=SUN2000';
    const res = parseBarcodeData(raw);
    expect(res.serial).toBe('2101073849100001');
    expect(res.sku).toBe('SUN2000');
    expect(res.format).toBe('huawei');
  });

  it('parses simple prefix format "SN: ..."', () => {
    const raw = 'SN: ABC-XYZ-9988';
    const res = parseBarcodeData(raw);
    expect(res.serial).toBe('ABC-XYZ-9988');
  });

  it('falls back to raw string for standard 1D Code 128 barcode', () => {
    const raw = 'PIN-CANADIAN-550W-00123';
    const res = parseBarcodeData(raw);
    expect(res.serial).toBe('PIN-CANADIAN-550W-00123');
    expect(res.format).toBe('generic');
  });
});
