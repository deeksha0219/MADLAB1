import { normalizePhoneNumber } from '../../src/services/authService';
import { isValidRvuEmail } from '../../src/services/profileService';

describe('GrabNGo - Authentication Foundation Test Suite', () => {
  describe('Phone Number Canonical Normalization (E.164)', () => {
    test('normalizes a standard 10-digit Indian mobile number', () => {
      expect(normalizePhoneNumber('9876543210')).toBe('+919876543210');
      expect(normalizePhoneNumber('8123456789')).toBe('+918123456789');
      expect(normalizePhoneNumber('7001234567')).toBe('+917001234567');
      expect(normalizePhoneNumber('6361234567')).toBe('+916361234567');
    });

    test('normalizes number with country code +91 or 91 prefix', () => {
      expect(normalizePhoneNumber('+919876543210')).toBe('+919876543210');
      expect(normalizePhoneNumber('919876543210')).toBe('+919876543210');
    });

    test('strips spaces, hyphens, and formatting characters', () => {
      expect(normalizePhoneNumber('98765 43210')).toBe('+919876543210');
      expect(normalizePhoneNumber('+91-98765-43210')).toBe('+919876543210');
      expect(normalizePhoneNumber(' (98765) 43210 ')).toBe('+919876543210');
    });

    test('rejects numbers with invalid lengths', () => {
      expect(() => normalizePhoneNumber('12345')).toThrow(/10 digits/);
      expect(() => normalizePhoneNumber('1234567890123')).toThrow(/10 digits/);
      expect(() => normalizePhoneNumber('')).toThrow(/required/);
    });

    test('rejects numbers not starting with 6, 7, 8, or 9', () => {
      expect(() => normalizePhoneNumber('1234567890')).toThrow(/valid 10-digit/);
      expect(() => normalizePhoneNumber('5234567890')).toThrow(/valid 10-digit/);
      expect(() => normalizePhoneNumber('0234567890')).toThrow(/valid 10-digit/);
    });
  });

  describe('RVU University Email Validation', () => {
    test('accepts valid @rvu.edu.in emails', () => {
      expect(isValidRvuEmail('student@rvu.edu.in')).toBe(true);
      expect(isValidRvuEmail('ananya.s@rvu.edu.in')).toBe(true);
      expect(isValidRvuEmail('VIKRAM.R@RVU.EDU.IN')).toBe(true);
    });

    test('rejects non-RVU domains', () => {
      expect(isValidRvuEmail('student@gmail.com')).toBe(false);
      expect(isValidRvuEmail('student@yahoo.com')).toBe(false);
      expect(isValidRvuEmail('student@rvu.com')).toBe(false);
      expect(isValidRvuEmail('student@rvce.edu.in')).toBe(false);
    });

    test('rejects empty or malformed inputs', () => {
      expect(isValidRvuEmail('')).toBe(false);
      expect(isValidRvuEmail('@rvu.edu.in')).toBe(false);
    });
  });
});
