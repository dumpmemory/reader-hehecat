const CONTENT_FLAGS = 4 | 8 | 32 | 64 | 128;
const LOCAL_FLAG = 256;
const KNOWN_FLAGS = CONTENT_FLAGS | 16 | LOCAL_FLAG | 512 | 1024;

export function normalizeBookContentType(value: number | undefined): 0 | 1 | 2 | 3 | 4 | undefined {
  if (value === undefined || !Number.isSafeInteger(value) || value < 0) {
    return undefined;
  }
  if (value <= 4) {
    return value as 0 | 1 | 2 | 3 | 4;
  }
  if (value > KNOWN_FLAGS || (value & ~KNOWN_FLAGS) !== 0) {
    return undefined;
  }
  switch (value & CONTENT_FLAGS) {
    case 8:
      return 0;
    case 32:
      return 1;
    case 64:
      return 2;
    case 128:
      return 3;
    case 4:
      return 4;
    default:
      return undefined;
  }
}

export function isLocalBookType(value: number | undefined): boolean {
  return value !== undefined && Number.isSafeInteger(value) && value >= 0
    && (value & LOCAL_FLAG) !== 0;
}
