/** Room codes. */

import { CODE_ALPHABET, CODE_LENGTH } from './limits';

/** A new code from `random`, a source of numbers in [0, 1). */
export function makeCode(random: () => number = Math.random): string {
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i++) code += CODE_ALPHABET[Math.floor(random() * CODE_ALPHABET.length)];
  return code;
}

/** What someone typed or pasted, as a code; null if it cannot be one. Accepts a full room link too. */
export function tidyCode(input: string): string | null {
  const linked = /\/r\/([^/?#]+)/.exec(input)?.[1] ?? input;
  const code = linked.toUpperCase().replace(/[\s-]/g, '');
  return code.length === CODE_LENGTH && [...code].every((char) => CODE_ALPHABET.includes(char)) ? code : null;
}
