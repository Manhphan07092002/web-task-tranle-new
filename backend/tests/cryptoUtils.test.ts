import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { encrypt, decrypt } from '../utils/cryptoUtils.js';

const initialMailEncryptionKey = process.env.MAIL_ENCRYPTION_KEY;
beforeEach(() => { process.env.MAIL_ENCRYPTION_KEY = 'crypto-utils-test-key'; });
afterEach(() => {
  if (initialMailEncryptionKey === undefined) delete process.env.MAIL_ENCRYPTION_KEY;
  else process.env.MAIL_ENCRYPTION_KEY = initialMailEncryptionKey;
});

describe('encrypt / decrypt', () => {
  it('round-trip: decrypt(encrypt(text)) === text', () => {
    const original = 'my-secret-password';
    expect(decrypt(encrypt(original)!)).toBe(original);
  });

  it('hoạt động với mật khẩu có ký tự đặc biệt', () => {
    const original = 'p@$$w0rd!#%^&*()_+áàảãạ';
    expect(decrypt(encrypt(original)!)).toBe(original);
  });

  it('hoạt động với chuỗi dài', () => {
    const original = 'a'.repeat(1000);
    expect(decrypt(encrypt(original)!)).toBe(original);
  });

  it('encrypt trả về định dạng versioned AES-GCM', () => {
    const result = encrypt('test');
    expect(result).toMatch(/^v2:[0-9a-f]+:[0-9a-f]+:[0-9a-f]+$/);
  });

  it('encrypt tạo IV ngẫu nhiên — cùng input cho kết quả khác nhau', () => {
    const a = encrypt('same-input');
    const b = encrypt('same-input');
    expect(a).not.toBe(b);
  });

  it('encrypt chuỗi rỗng trả về chính nó', () => {
    expect(encrypt('')).toBe('');
  });

  it('decrypt chuỗi rỗng trả về chính nó', () => {
    expect(decrypt('')).toBe('');
  });

  it('decrypt chuỗi không hợp lệ trả về null', () => {
    expect(decrypt('not-valid-hex-at-all')).toBeNull();
  });

  it('decrypt dữ liệu bị cắt bớt trả về null', () => {
    const encrypted = encrypt('hello')!;
    const corrupted = encrypted.slice(0, 10);
    expect(decrypt(corrupted)).toBeNull();
  });
});

describe('encrypt bảo mật', () => {
  it('ciphertext không chứa plaintext', () => {
    const secret = 'super-secret-password';
    const encrypted = encrypt(secret)!;
    expect(encrypted).not.toContain(secret);
  });

  it('hai plaintext khác nhau cho ciphertext khác nhau', () => {
    const a = encrypt('password1')!;
    const b = encrypt('password2')!;
    const cipherA = a.split(':')[3];
    const cipherB = b.split(':')[3];
    expect(cipherA).not.toBe(cipherB);
  });
});
