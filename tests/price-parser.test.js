import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parsePrice } from '../src/validation/normalizers.js';

describe('parsePrice', () => {

    describe('Euro formats', () => {
        it('should parse €99.99 format', () => {
            const result = parsePrice('€99.99');
            assert.equal(result.amount, 99.99);
            assert.equal(result.currency, 'EUR');
        });

        it('should parse 99.99€ format', () => {
            const result = parsePrice('99.99€');
            assert.equal(result.amount, 99.99);
            assert.equal(result.currency, 'EUR');
        });

        it('should parse € 99.99 with space', () => {
            const result = parsePrice('€ 99.99');
            assert.equal(result.amount, 99.99);
            assert.equal(result.currency, 'EUR');
        });

        it('should parse 99,99€ with comma decimal', () => {
            const result = parsePrice('99,99€');
            assert.equal(result.amount, 99.99);
            assert.equal(result.currency, 'EUR');
        });

        it('should parse EUR 150.00 format', () => {
            const result = parsePrice('EUR 150.00');
            assert.equal(result.amount, 150);
            assert.equal(result.currency, 'EUR');
        });

        it('should parse 150.00 EUR format', () => {
            const result = parsePrice('150.00 EUR');
            assert.equal(result.amount, 150);
            assert.equal(result.currency, 'EUR');
        });
    });

    describe('Dollar formats', () => {
        it('should parse $99.99 format', () => {
            const result = parsePrice('$99.99');
            assert.equal(result.amount, 99.99);
            assert.equal(result.currency, 'USD');
        });

        it('should parse 99.99$ format', () => {
            const result = parsePrice('99.99$');
            assert.equal(result.amount, 99.99);
            assert.equal(result.currency, 'USD');
        });

        it('should parse USD 150.00 format', () => {
            const result = parsePrice('USD 150.00');
            assert.equal(result.amount, 150);
            assert.equal(result.currency, 'USD');
        });
    });

    describe('Pound formats', () => {
        it('should parse £99.99 format', () => {
            const result = parsePrice('£99.99');
            assert.equal(result.amount, 99.99);
            assert.equal(result.currency, 'GBP');
        });

        it('should parse GBP 99.99 format', () => {
            const result = parsePrice('GBP 99.99');
            assert.equal(result.amount, 99.99);
            assert.equal(result.currency, 'GBP');
        });
    });

    describe('Edge cases', () => {
        it('should handle integer prices', () => {
            const result = parsePrice('€100');
            assert.equal(result.amount, 100);
            assert.equal(result.currency, 'EUR');
        });

        it('should handle prices with text around them', () => {
            const result = parsePrice('Price: €89.99 incl. VAT');
            assert.equal(result.amount, 89.99);
            assert.equal(result.currency, 'EUR');
        });

        it('should return null for invalid input', () => {
            const result = parsePrice('no price here');
            assert.equal(result.amount, null);
        });

        it('should handle empty string', () => {
            const result = parsePrice('');
            assert.equal(result.amount, null);
        });

        it('should handle null input', () => {
            const result = parsePrice(null);
            assert.equal(result.amount, null);
        });
    });

});
