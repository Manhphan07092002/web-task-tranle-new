import React, { useEffect, useRef, useState } from 'react';
import JsBarcode from 'jsbarcode';
import QRCode from 'qrcode';

export interface BarcodeRendererProps {
  value: string;
  type?: 'barcode' | 'qr';
  width?: number; // Bar width multiplier (default 1.5 - 2)
  height?: number; // Barcode height (default 35 - 45px)
  className?: string;
  alt?: string;
}

/**
 * Component hiển thị Barcode 1D (Code 128) hoặc QR Code 2D
 * Tối ưu hiển thị sắc nét cho cả màn hình và máy in nhiệt
 */
export function BarcodeRenderer({
  value,
  type = 'barcode',
  width = 1.8,
  height = 36,
  className = '',
  alt = 'Barcode',
}: BarcodeRendererProps) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string>('');

  useEffect(() => {
    if (!value) return;

    if (type === 'barcode' && svgRef.current) {
      try {
        JsBarcode(svgRef.current, String(value).trim(), {
          format: 'CODE128',
          width,
          height,
          displayValue: false,
          margin: 0,
          background: 'transparent',
          lineColor: '#000000',
        });
      } catch (err) {
        // Fallback nếu chuỗi có ký tự không hỗ trợ
        console.warn('JsBarcode render error for:', value, err);
      }
    } else if (type === 'qr') {
      QRCode.toDataURL(String(value).trim(), {
        margin: 1,
        width: height * 2.2 || 90,
        color: {
          dark: '#000000',
          light: '#ffffff',
        },
      })
        .then((url) => setQrDataUrl(url))
        .catch((err) => console.warn('QRCode render error:', err));
    }
  }, [value, type, width, height]);

  if (!value) {
    return <span className="text-gray-400 text-xs">—</span>;
  }

  if (type === 'qr') {
    if (!qrDataUrl) {
      return <div style={{ width: `${height * 2.2}px`, height: `${height * 2.2}px` }} className="bg-gray-100 animate-pulse" />;
    }
    return (
      <img
        src={qrDataUrl}
        alt={alt}
        className={`object-contain block ${className}`}
        style={{ width: `${height * 2.2}px`, height: `${height * 2.2}px` }}
      />
    );
  }

  return (
    <svg
      ref={svgRef}
      className={`block max-w-full ${className}`}
      style={{ height: `${height}px` }}
    />
  );
}
