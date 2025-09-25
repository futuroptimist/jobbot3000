const ASCII_WHITESPACE = new Uint8Array(33);
ASCII_WHITESPACE[9] = 1; // \t
ASCII_WHITESPACE[10] = 1; // \n
ASCII_WHITESPACE[11] = 1; // \v
ASCII_WHITESPACE[12] = 1; // \f
ASCII_WHITESPACE[13] = 1; // \r
ASCII_WHITESPACE[32] = 1; // space

function isSpaceCode(code) {
  if (!Number.isFinite(code)) return false;
  if (code <= 32) return ASCII_WHITESPACE[code] === 1;
  if (code >= 0x2000 && code <= 0x200a) return true;
  switch (code) {
    case 0x00a0:
    case 0x1680:
    case 0x2028:
    case 0x2029:
    case 0x202f:
    case 0x205f:
    case 0x3000:
    case 0xfeff:
      return true;
    default:
      return false;
  }
}

function isDigitCode(code) {
  return code >= 48 && code <= 57;
}

function isAlphaCode(code) {
  return (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
}

export function collapseWhitespace(str) {
  if (!str) return '';
  const trimmed = String(str).trim();
  if (!trimmed) return '';

  if (
    trimmed.indexOf('  ') === -1 &&
    trimmed.indexOf('\n') === -1 &&
    trimmed.indexOf('\r') === -1 &&
    trimmed.indexOf('\t') === -1 &&
    trimmed.indexOf('\f') === -1 &&
    trimmed.indexOf('\v') === -1 &&
    trimmed.indexOf('\u00a0') === -1 &&
    trimmed.indexOf('\u2028') === -1 &&
    trimmed.indexOf('\u2029') === -1
  ) {
    return trimmed;
  }

  return trimmed.split(/\s+/).join(' ');
}

const DOUBLE_QUOTE = 34;
const SINGLE_QUOTE = 39;
const OPEN_PARENS = 40;
const OPEN_BRACKET = 91;
const OPEN_BRACE = 123;
const CLOSE_PARENS = 41;
const CLOSE_BRACKET = 93;
const CLOSE_BRACE = 125;
const DOT = 46;
const EXCLAMATION = 33;
const QUESTION = 63;
const ELLIPSIS = 0x2026;

const abbreviations = new Set(['mr', 'mrs', 'ms', 'dr', 'prof', 'sr', 'jr', 'st', 'vs']);

export class SentenceExtractor {
  constructor(text) {
    this.text = text == null ? '' : String(text);
    this.length = this.text.length;
    this.cursor = 0;
    this.start = 0;
    this.parenDepth = 0;
    this.quoteCode = 0;
    this.trailingReturned = false;
  }

  reset(newText) {
    if (newText !== undefined) {
      this.text = newText == null ? '' : String(newText);
      this.length = this.text.length;
    }

    this.cursor = 0;
    this.start = 0;
    this.parenDepth = 0;
    this.quoteCode = 0;
    this.trailingReturned = false;
  }

  next() {
    if (this.start >= this.length) {
      this.cursor = this.length;
      this.trailingReturned = true;
      return null;
    }

    const text = this.text;
    const len = this.length;

    for (let i = this.cursor; i < len; i++) {
      const code = text.charCodeAt(i);
      this.cursor = i + 1;

      if (code === OPEN_PARENS || code === OPEN_BRACKET || code === OPEN_BRACE) {
        this.parenDepth++;
      } else if (code === CLOSE_PARENS || code === CLOSE_BRACKET || code === CLOSE_BRACE) {
        if (this.parenDepth > 0) this.parenDepth--;
      } else if (code === DOUBLE_QUOTE || code === SINGLE_QUOTE) {
        if (this.quoteCode === code) this.quoteCode = 0;
        else if (this.quoteCode === 0) this.quoteCode = code;
      }

      if (code !== DOT && code !== EXCLAMATION && code !== QUESTION && code !== ELLIPSIS) {
        continue;
      }

      if (
        code === DOT &&
        i > 0 &&
        isDigitCode(text.charCodeAt(i - 1)) &&
        i + 1 < len &&
        isDigitCode(text.charCodeAt(i + 1))
      ) {
        continue;
      }

      if (code === DOT) {
        let w = i - 1;
        while (w >= 0 && isAlphaCode(text.charCodeAt(w))) w--;
        const word = text.slice(w + 1, i).toLowerCase();
        if (abbreviations.has(word)) {
          continue;
        }
      }

      let j = i + 1;
      while (j < len) {
        const nextCode = text.charCodeAt(j);
        if (
          nextCode === DOT ||
          nextCode === EXCLAMATION ||
          nextCode === QUESTION ||
          nextCode === ELLIPSIS
        ) {
          j++;
          continue;
        }
        break;
      }

      while (j < len) {
        const closeCode = text.charCodeAt(j);
        if (
          closeCode === CLOSE_PARENS ||
          closeCode === CLOSE_BRACKET ||
          closeCode === CLOSE_BRACE ||
          closeCode === DOUBLE_QUOTE ||
          closeCode === SINGLE_QUOTE
        ) {
          if (
            closeCode === CLOSE_PARENS ||
            closeCode === CLOSE_BRACKET ||
            closeCode === CLOSE_BRACE
          ) {
            if (this.parenDepth > 0) this.parenDepth--;
          } else if (this.quoteCode && closeCode === this.quoteCode) {
            this.quoteCode = 0;
          }
          j++;
          continue;
        }
        break;
      }

      let k = j;
      while (k < len && isSpaceCode(text.charCodeAt(k))) k++;
      const hasTrailingWhitespace = k > j;

      let isLower = false;
      if (k < len) {
        const nextCode = text.charCodeAt(k);
        if (nextCode >= 0x61 && nextCode <= 0x7a) {
          isLower = true;
        } else if (nextCode >= 0x41 && nextCode <= 0x5a) {
          isLower = false;
        } else if (nextCode <= 0x7f) {
          isLower = false;
        } else {
          const nextChar = text[k];
          isLower =
            nextChar.toLowerCase() === nextChar && nextChar.toUpperCase() !== nextChar;
        }
      }

      if (
        this.parenDepth === 0 &&
        this.quoteCode === 0 &&
        (k === len || hasTrailingWhitespace) &&
        (k === len || !isLower)
      ) {
        const sentence = text.slice(this.start, j);
        this.start = k;
        this.cursor = k;
        this.parenDepth = 0;
        this.quoteCode = 0;
        this.trailingReturned = this.start >= len;
        return sentence;
      }
    }

    if (!this.trailingReturned && this.start < len) {
      const trailing = text.slice(this.start);
      this.start = len;
      this.cursor = len;
      this.parenDepth = 0;
      this.quoteCode = 0;
      this.trailingReturned = true;
      return trailing;
    }

    this.cursor = this.length;
    this.parenDepth = 0;
    this.quoteCode = 0;
    return null;
  }
}
