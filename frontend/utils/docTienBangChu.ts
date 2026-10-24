/**
 * Chuyển đổi số tiền (VND) thành chữ tiếng Việt chuẩn ngữ pháp kế toán.
 * Ví dụ: 2049372846 -> "Hai tỷ không trăm bốn mươi chín triệu ba trăm bảy mươi hai nghìn tám trăm bốn mươi sáu đồng."
 */
export function docTienBangChu(soTien: number | null | undefined): string {
  if (soTien === null || soTien === undefined || isNaN(soTien) || soTien === 0) {
    return 'Không đồng.';
  }

  const chuSo = ['không', 'một', 'hai', 'ba', 'bốn', 'năm', 'sáu', 'bảy', 'tám', 'chín'];

  function docBlock3(b: number, full: boolean): string {
    const tr = Math.floor(b / 100);
    const ch = Math.floor((b % 100) / 10);
    const dv = b % 10;
    let s = '';

    if (full || tr > 0) {
      s += chuSo[tr] + ' trăm ';
    }

    if (ch > 1) {
      s += chuSo[ch] + ' mươi ';
      if (dv === 1) s += 'mốt ';
      else if (dv === 5) s += 'lăm ';
      else if (dv > 0) s += chuSo[dv] + ' ';
    } else if (ch === 1) {
      s += 'mười ';
      if (dv === 5) s += 'lăm ';
      else if (dv > 0) s += chuSo[dv] + ' ';
    } else {
      if ((full || tr > 0) && dv > 0) s += 'lẻ ' + chuSo[dv] + ' ';
      else if (dv > 0) s += chuSo[dv] + ' ';
    }

    return s.trim();
  }

  const hang = ['', 'nghìn', 'triệu', 'tỷ', 'nghìn tỷ', 'triệu tỷ'];
  const absSo = Math.round(Math.abs(soTien));
  let strSo = absSo.toString();
  const blocks: number[] = [];

  while (strSo.length > 0) {
    blocks.push(parseInt(strSo.slice(-3), 10));
    strSo = strSo.slice(0, -3);
  }

  const res: string[] = [];
  let prevHasValue = false;

  for (let i = blocks.length - 1; i >= 0; i--) {
    const b = blocks[i];
    if (b > 0) {
      const isFirst = !prevHasValue;
      const text = docBlock3(b, !isFirst);
      if (text) {
        res.push(text + (hang[i] ? ' ' + hang[i] : ''));
      }
      prevHasValue = true;
    }
  }

  const out = (soTien < 0 ? 'Âm ' : '') + res.join(' ').trim() + ' đồng.';
  return out.charAt(0).toUpperCase() + out.slice(1);
}
