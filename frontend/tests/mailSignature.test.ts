import { describe, expect, it } from 'vitest';
import { getSignature } from '../pages/Mail/utils.js';

const user = {
  name: 'Văn Quang Hiến',
  role: 'Manager',
  department: 'Kho vận',
  phone: '0939 792 428',
  email: 'hienvq@tranlecorp.com.vn',
};

describe('getSignature (company logo, no job title)', () => {
  it('shows logo, name and department but no job title', () => {
    const html = getSignature(user);
    expect(html).toContain('<img');
    expect(html).toContain('logo-square.png');
    expect(html).toContain('Văn Quang Hiến');
    expect(html).toContain('Kho vận');
    expect(html).not.toContain('Manager');
  });

  it('lists HQ addresses and the nationwide warehouse network', () => {
    const html = getSignature(user);
    expect(html).toContain('275-277-279 Diên Hồng, Phường Hoà Xuân, Quận Cẩm Lệ, Đà Nẵng, Vietnam');
    expect(html).toContain('Số 2 Đường số 27, Khu Dân Cư Vạn Phúc, Phường Hiệp Bình, TP. Hồ Chí Minh');
    expect(html).toContain('Hệ thống kho vận toàn quốc');
    expect(html).toContain('Kho Cầu Nhật Tân, Vân Nội, Đông Anh');
    expect(html).toContain('Võ An Ninh - Phan Triêm');
    expect(html).toContain('02 Nguyễn Ảnh Thủ');
    expect(html).toContain('Phú Mỹ, Tân Thành, Bà Rịa - Vũng Tàu');
  });

  it('falls back to defaults for empty users', () => {
    const html = getSignature(null);
    expect(html).toContain('info@tranlecorp.com.vn');
    expect(html).toContain('0939 792 428');
  });
});
