// Pure helpers dùng chung cho serial/lot (không phụ thuộc DOM).
export function parseSerialList(raw: string | null | undefined): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of String(raw || '').split(/[,;\n]+/)) {
    const s = part.trim();
    if (s && !seen.has(s.toLowerCase())) { seen.add(s.toLowerCase()); out.push(s); }
  }
  return out;
}

export function serialMatchState(codes: string[], quantity: number): 'empty' | 'lot' | 'match' | 'mismatch' {
  if (codes.length === 0) return 'empty';
  if (codes.length === 1 && quantity > 1) return 'lot';
  return codes.length === quantity ? 'match' : 'mismatch';
}
