import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    normalizeBrand,
    normalizeColor,
    normalizeCurrency,
    normalizeSize,
    normalizeGender,
    extractSiteName
} from '../src/validation/normalizers.js';

describe('normalizeBrand', () => {
    it('should normalize Nike variations', () => {
        assert.equal(normalizeBrand('nike'), 'Nike');
        assert.equal(normalizeBrand('NIKE'), 'Nike');
        assert.equal(normalizeBrand('Nike'), 'Nike');
    });

    it('should normalize Adidas variations', () => {
        assert.equal(normalizeBrand('adidas'), 'Adidas');
        assert.equal(normalizeBrand('ADIDAS'), 'Adidas');
        assert.equal(normalizeBrand('Adidas Originals'), 'Adidas');
    });

    it('should handle unknown brands', () => {
        assert.equal(normalizeBrand('unknownbrand'), 'Unknownbrand');
    });

    it('should handle null input', () => {
        assert.equal(normalizeBrand(null), null);
    });
});

describe('normalizeColor', () => {
    it('should normalize English colors', () => {
        assert.equal(normalizeColor('black'), 'Black');
        assert.equal(normalizeColor('WHITE'), 'White');
        assert.equal(normalizeColor('Blue'), 'Blue');
    });

    it('should normalize Spanish colors', () => {
        assert.equal(normalizeColor('negro'), 'Black');
        assert.equal(normalizeColor('blanco'), 'White');
        assert.equal(normalizeColor('azul'), 'Blue');
    });

    it('should normalize French colors', () => {
        assert.equal(normalizeColor('noir'), 'Black');
        assert.equal(normalizeColor('blanc'), 'White');
        assert.equal(normalizeColor('bleu'), 'Blue');
    });

    it('should handle unknown colors', () => {
        assert.equal(normalizeColor('chartreuse'), 'Chartreuse');
    });

    it('should handle null input', () => {
        assert.equal(normalizeColor(null), null);
    });
});

describe('normalizeCurrency', () => {
    it('should normalize currency codes', () => {
        assert.equal(normalizeCurrency('eur'), 'EUR');
        assert.equal(normalizeCurrency('EUR'), 'EUR');
        assert.equal(normalizeCurrency('usd'), 'USD');
        assert.equal(normalizeCurrency('gbp'), 'GBP');
    });

    it('should normalize currency symbols', () => {
        assert.equal(normalizeCurrency('€'), 'EUR');
        assert.equal(normalizeCurrency('$'), 'USD');
        assert.equal(normalizeCurrency('£'), 'GBP');
    });

    it('should normalize currency names', () => {
        assert.equal(normalizeCurrency('euro'), 'EUR');
        assert.equal(normalizeCurrency('dollar'), 'USD');
        assert.equal(normalizeCurrency('pound'), 'GBP');
    });

    it('should handle null input', () => {
        assert.equal(normalizeCurrency(null), null);
    });
});

describe('normalizeSize', () => {
    it('should standardize size names', () => {
        assert.equal(normalizeSize('small'), 'S');
        assert.equal(normalizeSize('MEDIUM'), 'M');
        assert.equal(normalizeSize('Large'), 'L');
        assert.equal(normalizeSize('Extra Large'), 'XL');
    });

    it('should keep standard sizes as-is', () => {
        assert.equal(normalizeSize('M'), 'M');
        assert.equal(normalizeSize('XL'), 'XL');
    });

    it('should handle numeric sizes', () => {
        assert.equal(normalizeSize('42'), '42');
        assert.equal(normalizeSize('10.5'), '10.5');
    });

    it('should handle null input', () => {
        assert.equal(normalizeSize(null), null);
    });
});

describe('normalizeGender', () => {
    it('should normalize men variations', () => {
        assert.equal(normalizeGender('men'), 'men');
        assert.equal(normalizeGender('man'), 'men');
        assert.equal(normalizeGender('male'), 'men');
        assert.equal(normalizeGender("men's"), 'men');
    });

    it('should normalize women variations', () => {
        assert.equal(normalizeGender('women'), 'women');
        assert.equal(normalizeGender('woman'), 'women');
        assert.equal(normalizeGender('female'), 'women');
        assert.equal(normalizeGender("women's"), 'women');
    });

    it('should normalize multilingual inputs', () => {
        assert.equal(normalizeGender('hombre'), 'men');
        assert.equal(normalizeGender('femme'), 'women');
        assert.equal(normalizeGender('damen'), 'women');
    });

    it('should handle null input', () => {
        assert.equal(normalizeGender(null), null);
    });
});

describe('extractSiteName', () => {
    it('should extract site from URL', () => {
        assert.equal(extractSiteName('https://www.zalando.com/shoes/'), 'zalando');
    });

    it('should handle simple domain names', () => {
        assert.equal(extractSiteName('zalando.com'), 'zalando');
        assert.equal(extractSiteName('farfetch.com'), 'farfetch');
    });

    it('should match site names directly', () => {
        assert.equal(extractSiteName('zalando'), 'zalando');
        assert.equal(extractSiteName('google'), 'google');
    });

    it('should handle null input', () => {
        assert.equal(extractSiteName(null), null);
    });
});
