// Alphabet sans caractères ambigus (0/O, 1/I/L).
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const ROOM_CODE_LENGTH = 6;

export function generateRoomCode(random: () => number = Math.random): string {
  let code = "";
  for (let i = 0; i < ROOM_CODE_LENGTH; i++) code += ALPHABET[Math.floor(random() * ALPHABET.length)];
  return code;
}

/** Renvoie le code normalisé, ou null s'il est invalide. */
export function normalizeRoomCode(input: string): string | null {
  const code = input.trim().toUpperCase();
  return code.length === ROOM_CODE_LENGTH && [...code].every((c) => ALPHABET.includes(c)) ? code : null;
}
