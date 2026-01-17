import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';

// Mock the config module
process.env.DRY_RUN = 'true';

import { MockIntentParser } from '../src/agents/intent-parser.js';

describe('MockIntentParser', () => {
    const parser = new MockIntentParser();

    describe('Basic parsing', () => {
        it('should extract brand from query', async () => {
            const result = await parser.parse(
                'Find Nike sneakers under 100€',
                'test-task-1'
            );

            assert.equal(result.success, true);
            assert.equal(result.parsedTask.product.brand, 'Nike');
        });

        it('should extract price constraint', async () => {
            const result = await parser.parse(
                'Find shoes under 90€',
                'test-task-2'
            );

            assert.equal(result.success, true);
            assert.equal(result.parsedTask.constraints.max_price, 90);
            assert.equal(result.parsedTask.constraints.currency, 'EUR');
        });

        it('should extract color', async () => {
            const result = await parser.parse(
                'Find Nike black sneakers',
                'test-task-3'
            );

            assert.equal(result.success, true);
            assert.equal(result.parsedTask.product.color, 'Black');
        });

        it('should detect Google search mode', async () => {
            const result = await parser.parse(
                'Search for Adidas Samba on Google',
                'test-task-4'
            );

            assert.equal(result.success, true);
            assert.equal(result.parsedTask.sources.mode, 'google');
            assert.equal(result.parsedTask.search_strategy, 'google');
        });

        it('should detect specific sites mode', async () => {
            const result = await parser.parse(
                'Check Zalando and Farfetch for Nike shoes',
                'test-task-5'
            );

            assert.equal(result.success, true);
            assert.equal(result.parsedTask.sources.mode, 'specific_sites');
            assert.ok(result.parsedTask.sources.sites.includes('zalando'));
            assert.ok(result.parsedTask.sources.sites.includes('farfetch'));
        });
    });

    describe('Model extraction', () => {
        it('should extract Air Force 1', async () => {
            const result = await parser.parse(
                'Nike Air Force 1 white under 110€',
                'test-task-6'
            );

            assert.equal(result.parsedTask.product.model, 'Air Force 1');
        });

        it('should extract Samba', async () => {
            const result = await parser.parse(
                'Adidas Samba black',
                'test-task-7'
            );

            assert.equal(result.parsedTask.product.model, 'Samba');
        });

        it('should extract Down Sweater', async () => {
            const result = await parser.parse(
                'Patagonia Down Sweater jacket',
                'test-task-8'
            );

            assert.equal(result.parsedTask.product.model, 'Down Sweater');
        });
    });

    describe('Gender extraction', () => {
        it('should extract men gender', async () => {
            const result = await parser.parse(
                'Find men Nike sneakers',
                'test-task-9'
            );

            assert.equal(result.parsedTask.product.gender, 'men');
        });

        it('should extract women gender', async () => {
            const result = await parser.parse(
                'Find women Adidas shoes',
                'test-task-10'
            );

            assert.equal(result.parsedTask.product.gender, 'women');
        });
    });

    describe('Size extraction', () => {
        it('should extract size M', async () => {
            const result = await parser.parse(
                'Find Patagonia jacket size M',
                'test-task-11'
            );

            assert.equal(result.parsedTask.constraints.size, 'M');
        });

        it('should extract size XL', async () => {
            const result = await parser.parse(
                'Find hoodie XL size',
                'test-task-12'
            );

            assert.equal(result.parsedTask.constraints.size, 'XL');
        });
    });

    describe('Category extraction', () => {
        it('should extract sneakers category', async () => {
            const result = await parser.parse(
                'Find Nike sneakers',
                'test-task-13'
            );

            assert.equal(result.parsedTask.product.category, 'sneakers');
        });

        it('should extract jacket category', async () => {
            const result = await parser.parse(
                'Find Patagonia Down Sweater jacket',
                'test-task-14'
            );

            assert.equal(result.parsedTask.product.category, 'jacket');
        });
    });

    describe('Complex queries', () => {
        it('should parse complete query', async () => {
            const result = await parser.parse(
                'Let me know if Adidas Samba black drop below 90€ on Zalando or Farfetch',
                'test-task-15'
            );

            assert.equal(result.success, true);
            assert.equal(result.parsedTask.product.brand, 'Adidas');
            assert.equal(result.parsedTask.product.model, 'Samba');
            assert.equal(result.parsedTask.product.color, 'Black');
            assert.equal(result.parsedTask.constraints.max_price, 90);
            assert.equal(result.parsedTask.sources.mode, 'specific_sites');
            assert.ok(result.parsedTask.sources.sites.includes('zalando'));
        });
    });

    describe('Clarification requests', () => {
        it('should request clarification for vague query', async () => {
            const result = await parser.parse('find something cheap', 'test-task-16');

            // Low confidence due to missing brand
            assert.ok(result.parsedTask.confidence < 0.6);

            const clarification = await parser.requestClarification(result.parsedTask, 'test-task-16');
            assert.equal(clarification.needsClarification, true);
            assert.ok(clarification.questions.length > 0);
        });
    });
});
