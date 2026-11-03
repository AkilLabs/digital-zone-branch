// Secret code mapping: 1-K, 2-A, 3-M, 4-S, 5-R, 6-N, 7-V, 8-H, 9-T, 0-X
const SECRET_CODE_MAP: { [key: string]: string } = {
  '0': 'X',
  '1': 'A',
  '2': 'B',
  '3': 'C',
  '4': 'D',
  '5': 'E',
  '6': 'F',
  '7': 'G',
  '8': 'H',
  '9': 'I',
};

export const encodePrice = (price: number): string => {
  if (price === 0) return 'X';
  
  // Convert price to string, preserving decimals
  const priceStr = price.toString();
  
  // Encode each digit, preserve the decimal point
  const encoded = priceStr.split('').map(char => {
    if (char === '.') return '.';
    return SECRET_CODE_MAP[char] || char;
  }).join('');
  
  return encoded;
};

export const decodePrice = (encoded: string): number => {
  if (!encoded) return 0;

  // Reverse mapping
  const reverseMap: { [key: string]: string } = {
    'X': '0',
    'K': '1',
    'A': '2',
    'M': '3',
    'S': '4',
    'R': '5',
    'N': '6',
    'V': '7',
    'H': '8',
    'T': '9',
  };
  
  // Decode each character, preserve the decimal point
  const decoded = encoded.split('').map(char => {
    if (char === '.') return '.';
    return reverseMap[char] || char;
  }).join('');
  
  return parseFloat(decoded);
};
