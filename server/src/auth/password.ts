import bcrypt from 'bcryptjs';
import { config } from '../config';

// bcrypt cost 12 in production; cheap in tests so the suite stays fast.
const COST = config.isTest ? 4 : 12;

export const hashPassword = (plain: string): Promise<string> => bcrypt.hash(plain, COST);
export const verifyPassword = (plain: string, hash: string): Promise<boolean> => bcrypt.compare(plain, hash);

// Used to keep login timing similar whether or not the email exists.
export const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', COST);

/** At least 8 chars with a letter and a digit. Returns an error code (for translation) or null. */
export function passwordProblem(pw: string): string | null {
  if (pw.length < 8) return 'password_too_short';
  if (pw.length > 128) return 'too_long';
  if (!/[A-Za-z؀-ۿ]/.test(pw) || !/\d/.test(pw)) return 'password_weak';
  return null;
}
