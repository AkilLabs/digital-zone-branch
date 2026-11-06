// Secret Code Utility: Encodes wholesale purchase costs and profits into a 10-character cipher
// Default Mapping: 1-K, 2-A, 3-M, 4-S, 5-R, 6-N, 7-V, 8-H, 9-T, 0-X

export const DEFAULT_SECRET_CODE_MAP: Record<string, string> = {
  '1': 'K',
  '2': 'A',
  '3': 'M',
  '4': 'S',
  '5': 'R',
  '6': 'N',
  '7': 'V',
  '8': 'H',
  '9': 'T',
  '0': 'X',
};

export interface SecretCodeSettings {
  enabled: boolean;
  mapping: Record<string, string>;
  keyword?: string;
  updatedAt?: any;
  updatedBy?: string;
}

const STORAGE_KEY = 'secret_code_settings';

// In-memory cache initialized from localStorage or default
let cachedSettings: SecretCodeSettings = (() => {
  try {
    const raw = typeof window !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null;
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed.enabled === 'boolean' && parsed.mapping) {
        return {
          enabled: parsed.enabled,
          mapping: { ...DEFAULT_SECRET_CODE_MAP, ...parsed.mapping },
          keyword: parsed.keyword || ''
        };
      }
    }
  } catch (_e) {}
  return {
    enabled: true,
    mapping: { ...DEFAULT_SECRET_CODE_MAP },
    keyword: ''
  };
})();

// Listen for window storage/custom events for instant multi-component sync
if (typeof window !== 'undefined') {
  window.addEventListener('secret-code-changed', ((e: CustomEvent) => {
    if (e.detail) {
      cachedSettings = {
        enabled: e.detail.enabled ?? cachedSettings.enabled,
        mapping: { ...DEFAULT_SECRET_CODE_MAP, ...(e.detail.mapping || cachedSettings.mapping) },
        keyword: e.detail.keyword ?? cachedSettings.keyword
      };
    }
  }) as EventListener);

  window.addEventListener('storage', (e) => {
    if (e.key === STORAGE_KEY && e.newValue) {
      try {
        const parsed = JSON.parse(e.newValue);
        if (parsed) {
          cachedSettings = {
            enabled: parsed.enabled ?? true,
            mapping: { ...DEFAULT_SECRET_CODE_MAP, ...(parsed.mapping || {}) },
            keyword: parsed.keyword || ''
          };
        }
      } catch (_err) {}
    }
  });
}

/**
 * Returns current secret code settings
 */
export const getSecretCodeSettings = (): SecretCodeSettings => {
  return {
    enabled: cachedSettings.enabled,
    mapping: { ...cachedSettings.mapping },
    keyword: cachedSettings.keyword
  };
};

/**
 * Updates cache and localStorage, and broadcasts change event across app
 */
export const setCachedSecretCodeSettings = (settings: SecretCodeSettings) => {
  cachedSettings = {
    enabled: settings.enabled,
    mapping: { ...settings.mapping },
    keyword: settings.keyword
  };
  try {
    if (typeof window !== 'undefined') {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
      window.dispatchEvent(new CustomEvent('secret-code-changed', { detail: settings }));
    }
  } catch (_e) {}
};

/**
 * Validates that each digit 0-9 is present, non-empty, and unique (no duplicate characters).
 */
export const validateSecretCodeMapping = (
  mapping: Record<string, string>
): { isValid: boolean; error?: string; duplicates: string[] } => {
  const digits = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'];
  const seenChars = new Map<string, string>(); // charUpper -> digit
  const duplicates: string[] = [];

  for (const digit of digits) {
    const rawVal = mapping[digit];
    if (!rawVal || typeof rawVal !== 'string' || !rawVal.trim()) {
      return {
        isValid: false,
        error: `Digit ${digit} is missing a secret code character.`,
        duplicates: []
      };
    }
    const char = rawVal.trim().toUpperCase();
    if (char.length > 1) {
      return {
        isValid: false,
        error: `Digit ${digit} must be a single character (got "${char}").`,
        duplicates: []
      };
    }
    if (seenChars.has(char)) {
      duplicates.push(char);
    } else {
      seenChars.set(char, digit);
    }
  }

  if (duplicates.length > 0) {
    const uniqueDups = Array.from(new Set(duplicates));
    return {
      isValid: false,
      error: `Each digit must map to a unique character. Duplicate: ${uniqueDups.join(', ')}`,
      duplicates: uniqueDups
    };
  }

  return { isValid: true, duplicates: [] };
};

/**
 * Encodes a numeric price/cost value using the secret code mapping.
 * Preserves decimals and negative signs.
 * If secret code is disabled, returns plain formatted cost.
 */
export const encodePrice = (price: number | string | undefined | null): string => {
  if (price === undefined || price === null || price === '') return '';

  const settings = getSecretCodeSettings();
  if (!settings.enabled) {
    if (typeof price === 'number') {
      return String(Math.round(price));
    }
    return String(price);
  }

  const map = settings.mapping || DEFAULT_SECRET_CODE_MAP;

  // If number, round to nearest rupee or keep decimals
  if (typeof price === 'number') {
    if (price === 0) return map['0'] || 'X';
    const priceStr = price.toString();
    return priceStr
      .split('')
      .map((char) => {
        if (char === '.') return '.';
        if (char === '-') return '-';
        return map[char] || char;
      })
      .join('');
  }

  // If string, handle potential symbols or spaces
  const str = String(price).trim();
  if (!str) return '';
  return str
    .split('')
    .map((char) => {
      if (/[0-9]/.test(char)) {
        return map[char] || char;
      }
      return char;
    })
    .join('');
};

/**
 * Decodes an encoded secret code string back into a numeric price.
 */
export const decodePrice = (encoded: string): number => {
  if (!encoded || !encoded.trim()) return 0;

  const settings = getSecretCodeSettings();
  if (!settings.enabled) {
    const raw = parseFloat(String(encoded).replace(/[^0-9.-]/g, ''));
    return isNaN(raw) ? 0 : raw;
  }

  const map = settings.mapping || DEFAULT_SECRET_CODE_MAP;
  // Construct dynamic reverse map: char.toUpperCase() -> digit
  const reverseMap: Record<string, string> = {};
  for (const [digit, char] of Object.entries(map)) {
    if (char) {
      reverseMap[char.toUpperCase()] = digit;
      reverseMap[char.toLowerCase()] = digit;
    }
  }

  const cleaned = encoded.trim();
  const decodedStr = cleaned
    .split('')
    .map((char) => {
      if (char === '.' || char === '-') return char;
      return reverseMap[char] !== undefined ? reverseMap[char] : char;
    })
    .join('');

  const num = parseFloat(decodedStr);
  return isNaN(num) ? 0 : num;
};
