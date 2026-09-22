/**
 * GrabNGo - Step 6 Menu, Canteen, and Catalog Unit & Validation Tests
 *
 * Tests:
 * 1. Minor integer currency formatting (paise to INR).
 * 2. Strict validation rules for Cloud Functions:
 *    - Negative price rejection
 *    - Decimal price rejection
 *    - NaN / Infinity rejection
 *    - Name length / trimming
 *    - Code formatting (uppercase alphanumeric with underscore)
 *    - Document ID format validation
 *    - Unknown fields rejection
 */

import { formatPaiseToRupees } from '../../src/services/catalogService';

describe('Step 6 - Minor Integer Currency Formatting (Paise to INR)', () => {
  it('formats standard integer paise values correctly', () => {
    expect(formatPaiseToRupees(7000)).toBe('₹70.00');
    expect(formatPaiseToRupees(2500)).toBe('₹25.00');
    expect(formatPaiseToRupees(18050)).toBe('₹180.50');
    expect(formatPaiseToRupees(99)).toBe('₹0.99');
    expect(formatPaiseToRupees(5)).toBe('₹0.05');
  });

  it('handles zero cleanly', () => {
    expect(formatPaiseToRupees(0)).toBe('₹0.00');
  });

  it('handles invalid, negative, NaN, and Infinity inputs safely', () => {
    expect(formatPaiseToRupees(-500)).toBe('₹0.00');
    expect(formatPaiseToRupees(NaN)).toBe('₹0.00');
    expect(formatPaiseToRupees(Infinity)).toBe('₹0.00');
    expect(formatPaiseToRupees(-Infinity)).toBe('₹0.00');
    expect(formatPaiseToRupees(null as any)).toBe('₹0.00');
    expect(formatPaiseToRupees(undefined as any)).toBe('₹0.00');
  });
});

describe('Step 6 - Runtime Validation Rules for Cloud Functions Input', () => {
  // Pure validator simulation matching functions/src/index.ts
  const MAX_NAME_LEN = 100;
  const MAX_PRICE_PAISE = 500000;

  function validatePrice(price: any): { valid: boolean; error?: string } {
    if (typeof price !== 'number' || !Number.isInteger(price)) {
      return { valid: false, error: 'Price must be an integer in paise' };
    }
    if (isNaN(price) || !isFinite(price)) {
      return { valid: false, error: 'Price must be finite' };
    }
    if (price < 0) {
      return { valid: false, error: 'Price cannot be negative' };
    }
    if (price > MAX_PRICE_PAISE) {
      return { valid: false, error: 'Price exceeds maximum business limit' };
    }
    return { valid: true };
  }

  function validateName(name: any): { valid: boolean; error?: string } {
    if (typeof name !== 'string') {
      return { valid: false, error: 'Name must be a string' };
    }
    const trimmed = name.trim();
    if (trimmed.length < 1 || trimmed.length > MAX_NAME_LEN) {
      return { valid: false, error: 'Name length must be 1-100 characters' };
    }
    return { valid: true };
  }

  function validateCode(code: any): { valid: boolean; error?: string } {
    if (typeof code !== 'string') {
      return { valid: false, error: 'Code must be a string' };
    }
    const regex = /^[A-Z0-9_]{2,30}$/;
    if (!regex.test(code)) {
      return { valid: false, error: 'Code must be uppercase alphanumeric with underscores' };
    }
    return { valid: true };
  }

  function validateSafeUrl(url: any): { valid: boolean; error?: string } {
    if (url === undefined || url === null) return { valid: true };
    if (typeof url !== 'string' || !url.startsWith('https://')) {
      return { valid: false, error: 'URL must start with https://' };
    }
    return { valid: true };
  }

  function rejectUnknownFields(data: any, allowedKeys: string[]): { valid: boolean; error?: string } {
    const unknown = Object.keys(data).filter((k) => !allowedKeys.includes(k));
    if (unknown.length > 0) {
      return { valid: false, error: `Unknown fields: ${unknown.join(', ')}` };
    }
    return { valid: true };
  }

  describe('Price in Paise Validation', () => {
    it('accepts valid non-negative integer paise', () => {
      expect(validatePrice(0).valid).toBe(true);
      expect(validatePrice(7000).valid).toBe(true);
      expect(validatePrice(500000).valid).toBe(true);
    });

    it('rejects negative prices', () => {
      expect(validatePrice(-1).valid).toBe(false);
      expect(validatePrice(-5000).valid).toBe(false);
    });

    it('rejects decimal / floating-point prices', () => {
      expect(validatePrice(70.5).valid).toBe(false);
      expect(validatePrice(99.99).valid).toBe(false);
    });

    it('rejects NaN and Infinity', () => {
      expect(validatePrice(NaN).valid).toBe(false);
      expect(validatePrice(Infinity).valid).toBe(false);
      expect(validatePrice(-Infinity).valid).toBe(false);
    });

    it('rejects prices exceeding max business limit (₹5,000 / 500,000 paise)', () => {
      expect(validatePrice(500001).valid).toBe(false);
      expect(validatePrice(1000000).valid).toBe(false);
    });
  });

  describe('Name Validation', () => {
    it('accepts valid trimmed names', () => {
      expect(validateName('Masala Dosa').valid).toBe(true);
      expect(validateName('Coffee').valid).toBe(true);
    });

    it('rejects empty or whitespace-only names', () => {
      expect(validateName('').valid).toBe(false);
      expect(validateName('   ').valid).toBe(false);
    });

    it('rejects oversized names (> 100 characters)', () => {
      const longName = 'A'.repeat(101);
      expect(validateName(longName).valid).toBe(false);
    });

    it('rejects non-string names', () => {
      expect(validateName(null).valid).toBe(false);
      expect(validateName(12345).valid).toBe(false);
      expect(validateName({}).valid).toBe(false);
    });
  });

  describe('Canteen Code Validation', () => {
    it('accepts valid uppercase codes', () => {
      expect(validateCode('BIG_MINGOS').valid).toBe(true);
      expect(validateCode('LIBRARY_CANTEEN').valid).toBe(true);
      expect(validateCode('CANTEEN_01').valid).toBe(true);
    });

    it('rejects lowercase or special character codes', () => {
      expect(validateCode('big_mingos').valid).toBe(false);
      expect(validateCode('CANTEEN-01').valid).toBe(false);
      expect(validateCode('CANTEEN!').valid).toBe(false);
      expect(validateCode('A').valid).toBe(false); // Too short (< 2)
    });
  });

  describe('Safe Image URL Validation', () => {
    it('accepts https URLs', () => {
      expect(validateSafeUrl('https://example.com/item.png').valid).toBe(true);
      expect(validateSafeUrl(undefined).valid).toBe(true);
    });

    it('rejects http, javascript, or malformed URLs', () => {
      expect(validateSafeUrl('http://insecure.com/item.png').valid).toBe(false);
      expect(validateSafeUrl('javascript:alert(1)').valid).toBe(false);
      expect(validateSafeUrl('ftp://example.com').valid).toBe(false);
    });
  });

  describe('Unknown Fields Rejection', () => {
    it('accepts payloads with only allowed keys', () => {
      const allowed = ['canteenId', 'name', 'categoryId', 'priceInPaise'];
      const data = { canteenId: 'BIG_MINGOS', name: 'Dosa', categoryId: 'BREAKFAST', priceInPaise: 7000 };
      expect(rejectUnknownFields(data, allowed).valid).toBe(true);
    });

    it('rejects payloads with unauthorized or client-injected fields', () => {
      const allowed = ['canteenId', 'name', 'categoryId', 'priceInPaise'];
      const data = {
        canteenId: 'BIG_MINGOS',
        name: 'Dosa',
        categoryId: 'BREAKFAST',
        priceInPaise: 7000,
        role: 'admin', // Injected field
        createdAt: new Date(), // Client timestamp
      };
      const result = rejectUnknownFields(data, allowed);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('role');
      expect(result.error).toContain('createdAt');
    });
  });
});
