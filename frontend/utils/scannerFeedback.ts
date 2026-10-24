/**
 * Hệ thống âm thanh & phản hồi rung (Audio & Haptic Feedback) chuyên dụng cho máy quét kho
 * Tối ưu cho thiết bị di động, máy quét PDA và môi trường nhà kho nhiều tiếng ồn
 */

function getAudioContext(): AudioContext | null {
  try {
    const Ctx = window.AudioContext || (window as any).webkitAudioContext;
    if (!Ctx) return null;
    return new Ctx();
  } catch {
    return null;
  }
}

/**
 * Âm thanh báo QUÉT THÀNH CÔNG (Crisp High Pitch Chime)
 * Kèm rung nhẹ 45ms trên thiết bị di động
 */
export function playSuccessBeep() {
  // 1. Phản hồi rung
  try {
    if (typeof navigator !== 'undefined' && navigator.vibrate) {
      navigator.vibrate(45);
    }
  } catch { /* Bỏ qua nếu thiết bị không hỗ trợ rung */ }

  // 2. Phản hồi âm thanh
  try {
    const ctx = getAudioContext();
    if (!ctx) return;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.connect(gain);
    gain.connect(ctx.destination);

    // Chuyển tần số nốt Đô -> nốt Mi cao (1046Hz -> 1318Hz) tạo cảm giác nhận diện thành công
    osc.type = 'sine';
    osc.frequency.setValueAtTime(1046.5, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(1318.5, ctx.currentTime + 0.08);

    gain.gain.setValueAtTime(0.15, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.12);

    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.12);

    setTimeout(() => {
      ctx.close().catch(() => {});
    }, 250);
  } catch { /* Bỏ qua nếu bị chặn audio */ }
}

/**
 * Âm thanh báo LỖI QUÉT (Low Warning Buzz - 2 nhịp dồn dập)
 * Dành cho: Trùng serial, sai kho, sai sản phẩm, vượt số lượng
 * Kèm rung cảnh báo mạnh 2 nhịp [120ms, 60ms, 120ms]
 */
export function playErrorBuzz() {
  // 1. Phản hồi rung mạnh cảnh báo
  try {
    if (typeof navigator !== 'undefined' && navigator.vibrate) {
      navigator.vibrate([120, 60, 120]);
    }
  } catch { /* Bỏ qua */ }

  // 2. Phản hồi âm thanh trầm cảnh báo
  try {
    const ctx = getAudioContext();
    if (!ctx) return;

    // Nhịp 1
    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.connect(gain1);
    gain1.connect(ctx.destination);
    osc1.type = 'sawtooth';
    osc1.frequency.setValueAtTime(180, ctx.currentTime);
    gain1.gain.setValueAtTime(0.2, ctx.currentTime);
    gain1.gain.linearRampToValueAtTime(0.01, ctx.currentTime + 0.1);
    osc1.start(ctx.currentTime);
    osc1.stop(ctx.currentTime + 0.1);

    // Nhịp 2
    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.connect(gain2);
    gain2.connect(ctx.destination);
    osc2.type = 'sawtooth';
    osc2.frequency.setValueAtTime(150, ctx.currentTime + 0.12);
    gain2.gain.setValueAtTime(0.25, ctx.currentTime + 0.12);
    gain2.gain.linearRampToValueAtTime(0.01, ctx.currentTime + 0.25);
    osc2.start(ctx.currentTime + 0.12);
    osc2.stop(ctx.currentTime + 0.25);

    setTimeout(() => {
      ctx.close().catch(() => {});
    }, 400);
  } catch { /* Bỏ qua */ }
}

/**
 * Âm thanh CẢNH BÁO (Ví dụ: Phiếu đã đủ số lượng, quét mã đã có)
 */
export function playWarningBeep() {
  try {
    if (typeof navigator !== 'undefined' && navigator.vibrate) {
      navigator.vibrate(80);
    }
  } catch { /* noop */ }

  try {
    const ctx = getAudioContext();
    if (!ctx) return;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.type = 'triangle';
    osc.frequency.setValueAtTime(650, ctx.currentTime);
    gain.gain.setValueAtTime(0.18, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.18);

    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.18);

    setTimeout(() => {
      ctx.close().catch(() => {});
    }, 300);
  } catch { /* noop */ }
}
