// Standard PDF fonts only cover WinAnsi (cp1252); anything else becomes "?".
const CP1252_EXTRA = '€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ';
export const toWinAnsi = (s: string): string =>
  [...s.normalize('NFC')].map((ch) => {
    const c = ch.codePointAt(0)!;
    if (c === 10 || (c >= 32 && c < 127) || (c >= 160 && c <= 255) || CP1252_EXTRA.includes(ch)) return ch;
    if (ch === '→') return '->';
    return '?';
  }).join('');
