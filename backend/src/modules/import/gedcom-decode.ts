/**
 * Turns the bytes of a GEDCOM file into text. Files in the wild use UTF-8 (with or without a byte-order
 * mark), UTF-16, ANSEL (the GEDCOM 5.x default, a MARC-8 variant with combining accents written
 * before the letter), Windows-1252 ("ANSI") and Mac Roman.
 */

/** ANSEL characters that stand alone (0xA1–0xCF). */
const ANSEL_SPECIAL: Record<number, string> = {
  0xa1: 'Ł', 0xa2: 'Ø', 0xa3: 'Đ', 0xa4: 'Þ', 0xa5: 'Æ', 0xa6: 'Œ', 0xa7: 'ʹ', 0xa8: '·', 0xa9: '♭', 0xaa: '®',
  0xab: '±', 0xac: 'Ơ', 0xad: 'Ư', 0xae: 'ʼ', 0xb0: 'ʻ', 0xb1: 'ł', 0xb2: 'ø', 0xb3: 'đ', 0xb4: 'þ', 0xb5: 'æ',
  0xb6: 'œ', 0xb7: 'ʺ', 0xb8: 'ı', 0xb9: '£', 0xba: 'ð', 0xbc: 'ơ', 0xbd: 'ư', 0xbe: '□', 0xbf: '■', 0xc0: '°',
  0xc1: 'ℓ', 0xc2: '℗', 0xc3: '©', 0xc4: '♯', 0xc5: '¿', 0xc6: '¡', 0xc7: 'ß', 0xc8: '€', 0xcd: 'e', 0xce: 'o',
  0xcf: 'ß',
};

/** ANSEL combining marks (0xE0–0xFE), written before the letter they modify. */
const ANSEL_COMBINING: Record<number, string> = {
  0xe0: '̉', 0xe1: '̀', 0xe2: '́', 0xe3: '̂', 0xe4: '̃', 0xe5: '̄', 0xe6: '̆',
  0xe7: '̇', 0xe8: '̈', 0xe9: '̌', 0xea: '̊', 0xeb: '︠', 0xec: '︡', 0xed: '̕',
  0xee: '̋', 0xef: '̐', 0xf0: '̧', 0xf1: '̨', 0xf2: '̣', 0xf3: '̤', 0xf4: '̥',
  0xf5: '̳', 0xf6: '̲', 0xf7: '̦', 0xf8: '̜', 0xf9: '̮', 0xfa: '︢', 0xfb: '︣',
  0xfe: '̓',
};

export function decodeAnsel(bytes: Uint8Array): string {
  let out = '';
  let pending = '';
  for (const b of bytes) {
    const mark = ANSEL_COMBINING[b];
    if (mark) {
      pending += mark;
      continue;
    }
    const ch = b < 0x80 ? String.fromCharCode(b) : (ANSEL_SPECIAL[b] ?? '�');
    // A combining mark applies to the next base character; Unicode writes it after.
    out += ch + pending;
    pending = '';
  }
  return (out + pending).normalize('NFC');
}

function decodeWith(label: string, bytes: Uint8Array): string {
  return new TextDecoder(label).decode(bytes);
}

/** Character set declared in the header (`1 CHAR …`), read without knowing the encoding yet. */
function declaredCharset(bytes: Uint8Array): string {
  const head = Buffer.from(bytes.subarray(0, 4096)).toString('latin1');
  return /^\s*1\s+CHAR\s+(\S+)/m.exec(head)?.[1]?.toUpperCase() ?? '';
}

export interface DecodedGedcom {
  text: string;
  /** Encoding actually used. */
  charset: string;
}

export function decodeGedcom(bytes: Uint8Array): DecodedGedcom {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return { text: decodeWith('utf-8', bytes.subarray(3)), charset: 'UTF-8' };
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return { text: decodeWith('utf-16le', bytes.subarray(2)), charset: 'UTF-16' };
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return { text: decodeWith('utf-16be', bytes.subarray(2)), charset: 'UTF-16' };
  // UTF-16 without a byte-order mark: "0 HEAD" with a zero byte after (LE) or before (BE) each letter.
  if (bytes.length > 3 && bytes[1] === 0 && bytes[3] === 0) return { text: decodeWith('utf-16le', bytes), charset: 'UTF-16' };
  if (bytes.length > 3 && bytes[0] === 0 && bytes[2] === 0) return { text: decodeWith('utf-16be', bytes), charset: 'UTF-16' };

  const declared = declaredCharset(bytes);
  if (declared === 'ANSEL') return { text: decodeAnsel(bytes), charset: 'ANSEL' };
  if (declared === 'MACINTOSH') return { text: decodeWith('macintosh', bytes), charset: 'MACINTOSH' };
  if (['ANSI', 'IBMPC', 'IBM', 'WINDOWS', 'CP1252', 'WINDOWS-1252', 'LATIN1', 'ISO-8859-1'].includes(declared)) {
    return { text: decodeWith('windows-1252', bytes), charset: declared };
  }
  // UTF-8 or ASCII as declared, or nothing declared: use UTF-8 when the bytes are valid UTF-8.
  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(bytes), charset: declared || 'UTF-8' };
  } catch {
    return { text: decodeWith('windows-1252', bytes), charset: 'WINDOWS-1252' };
  }
}
