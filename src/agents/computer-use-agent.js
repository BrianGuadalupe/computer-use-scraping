import { GoogleGenerativeAI } from '@google/generative-ai';
import { chromium } from 'playwright';
import path from 'path';
import config from '../config.js';
import { createTaskLogger } from '../logger.js';

/**
 * Screen dimensions for Computer Use
 * Model outputs normalized coordinates (0-999) regardless of screen size
 */
const SCREEN_WIDTH = 1440;
const SCREEN_HEIGHT = 900;

/**
 * Computer Use Agent - Uses Gemini 2.5 Computer Use Preview model
 * Based on official documentation: https://ai.google.dev/gemini-api/docs/computer-use
 */
export class ComputerUseAgent {
    constructor() {
        const genAI = new GoogleGenerativeAI(config.geminiApiKey);

        // Use the official Computer Use model
        this.model = genAI.getGenerativeModel({
            model: 'gemini-2.5-computer-use-preview-10-2025',
            // Configure the computer_use tool
            tools: [{
                computerUse: {
                    environment: 'ENVIRONMENT_BROWSER',
                    // Optionally exclude functions we don't need
                    // excludedPredefinedFunctions: ['drag_and_drop']
                }
            }],
        });

        this.browser = null;
        this.context = null;
        this.page = null;
        this.conversationHistory = [];
        this.maxTurns = config.computerUseMaxSteps || 20;
    }

    /**
     * Convert normalized x coordinate (0-999) to actual pixel coordinate
     */
    denormalizeX(x) {
        return Math.round((x / 1000) * SCREEN_WIDTH);
    }

    /**
     * Convert normalized y coordinate (0-999) to actual pixel coordinate
     */
    denormalizeY(y) {
        return Math.round((y / 1000) * SCREEN_HEIGHT);
    }

    /**
     * Initialize browser with correct viewport
     */
    async init(taskId) {
        this.logger = createTaskLogger(taskId, 'ComputerUseAgent');
        this.logger.info('Initializing browser for Computer Use', {
            model: 'gemini-2.5-computer-use-preview-10-2025',
            screenSize: `${SCREEN_WIDTH}x${SCREEN_HEIGHT}`
        });

        this.browser = await chromium.launch({
            headless: config.headless,
            slowMo: config.debugMode ? 500 : 100,
        });

        this.context = await this.browser.newContext({
            viewport: { width: SCREEN_WIDTH, height: SCREEN_HEIGHT },
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        });

        this.page = await this.context.newPage();
        this.conversationHistory = [];

        // Navigate to initial page (Google)
        await this.page.goto('https://www.google.com');
        await this.page.waitForLoadState('domcontentloaded');

        this.logger.info('Browser initialized, starting at Google.com');
    }

    /**
     * Capture screenshot as base64
     */
    async captureScreenshot() {
        const buffer = await this.page.screenshot({ type: 'png' });
        return buffer.toString('base64');
    }

    /**
     * Get current page URL
     */
    getCurrentUrl() {
        return this.page.url();
    }

    /**
     * Main execution loop - implements the agent loop from documentation
     */
    async executeTask(goal, taskId) {
        await this.init(taskId);
        this.logger.info('Starting Computer Use task', { goal });

        const extractedResults = [];
        let turn = 0;

        try {
            // Capture initial screenshot
            const initialScreenshot = await this.captureScreenshot();

            // Initialize conversation with user goal and initial screenshot
            this.conversationHistory = [{
                role: 'user',
                parts: [
                    { text: goal },
                    {
                        inlineData: {
                            mimeType: 'image/png',
                            data: initialScreenshot
                        }
                    }
                ]
            }];

            // Agent loop
            while (turn < this.maxTurns) {
                turn++;
                this.logger.info(`--- Turn ${turn}/${this.maxTurns} ---`);

                // 1. Send request to model with retry logic
                const response = await this.generateContentWithRetry(this.conversationHistory);

                const candidate = response.response.candidates[0];
                const content = candidate.content;

                // Add model response to history
                this.conversationHistory.push(content);

                // 2. Check for function calls
                const functionCalls = this.extractFunctionCalls(content);

                if (functionCalls.length === 0) {
                    // No function calls - model is done or providing text response
                    const textResponse = this.extractTextResponse(content);
                    this.logger.info('Model finished with text response', { text: textResponse?.substring(0, 200) });

                    // Try to extract any data mentioned in the text response
                    if (textResponse) {
                        const parsedData = this.parseTextForProducts(textResponse);
                        if (parsedData.length > 0) {
                            extractedResults.push(...parsedData);
                        }
                    }
                    break;
                }

                // 3. Execute each function call
                this.logger.info(`Executing ${functionCalls.length} action(s)`);
                const functionResponses = [];

                for (const fc of functionCalls) {
                    const fname = fc.name;
                    const args = fc.args || {};

                    // Check for safety decision
                    if (args.safety_decision?.decision === 'require_confirmation') {
                        this.logger.warn('Safety confirmation required', {
                            explanation: args.safety_decision.explanation
                        });
                        // In production, would prompt user here
                        // For now, we'll skip the action
                        continue;
                    }

                    this.logger.info(`Executing: ${fname}`, { args });

                    try {
                        await this.executeAction(fname, args);

                        // Wait for page to stabilize
                        await this.page.waitForLoadState('domcontentloaded', { timeout: 10000 }).catch(() => { });
                        await this.page.waitForTimeout(1000);

                    } catch (error) {
                        this.logger.error(`Error executing ${fname}`, { error: error.message });
                    }

                    // 4. Capture new state after action
                    const screenshot = await this.captureScreenshot();
                    const currentUrl = this.getCurrentUrl();

                    // Save screenshot as evidence
                    const screenshotPath = await this.saveScreenshot(`action_${turn}_${fname}`);

                    functionResponses.push({
                        functionResponse: {
                            name: fname,
                            response: {
                                url: currentUrl,
                                screenshot_path: screenshotPath,
                            }
                        },
                        inlineData: {
                            mimeType: 'image/png',
                            data: screenshot
                        }
                    });

                    // Try to extract visible product data from current page
                    const pageData = await this.extractVisibleProducts();
                    if (pageData.length > 0) {
                        extractedResults.push(...pageData.map(p => ({
                            ...p,
                            source_url: currentUrl,
                            screenshot_path: screenshotPath,
                        })));
                    }
                }

                // Add function responses to conversation history
                if (functionResponses.length > 0) {
                    this.conversationHistory.push({
                        role: 'user',
                        parts: functionResponses.map(fr => ({
                            functionResponse: fr.functionResponse,
                            inlineData: fr.inlineData
                        }))
                    });
                }
            }

            this.logger.info('Computer Use task completed', {
                turns: turn,
                resultsCount: extractedResults.length
            });

            return {
                success: true,
                results: this.deduplicateResults(extractedResults),
                turns: turn,
            };

        } catch (error) {
            this.logger.error('Computer Use task failed', { error: error.message });
            return {
                success: false,
                error: error.message,
                results: extractedResults,
                turns: turn,
            };
        } finally {
            await this.cleanup();
        }
    }

    /**
     * Extract function calls from model response
     */
    extractFunctionCalls(content) {
        const functionCalls = [];
        if (content.parts) {
            for (const part of content.parts) {
                if (part.functionCall) {
                    functionCalls.push(part.functionCall);
                }
            }
        }
        return functionCalls;
    }

    /**
     * Extract text response from model content
     */
    extractTextResponse(content) {
        if (content.parts) {
            const textParts = content.parts
                .filter(p => p.text)
                .map(p => p.text);
            return textParts.join(' ');
        }
        return null;
    }

    /**
     * Execute a Computer Use action
     * Implements all supported actions from the documentation
     */
    async executeAction(fname, args) {
        switch (fname) {
            case 'open_web_browser':
                // Browser already open
                break;

            case 'wait_5_seconds':
                await this.page.waitForTimeout(5000);
                break;

            case 'go_back':
                await this.page.goBack();
                break;

            case 'go_forward':
                await this.page.goForward();
                break;

            case 'search':
                await this.page.goto('https://www.google.com');
                break;

            case 'navigate':
                await this.page.goto(args.url, { timeout: 30000 });
                break;

            case 'click_at':
                const clickX = this.denormalizeX(args.x);
                const clickY = this.denormalizeY(args.y);
                await this.page.mouse.click(clickX, clickY);
                break;

            case 'hover_at':
                const hoverX = this.denormalizeX(args.x);
                const hoverY = this.denormalizeY(args.y);
                await this.page.mouse.move(hoverX, hoverY);
                break;

            case 'type_text_at':
                const typeX = this.denormalizeX(args.x);
                const typeY = this.denormalizeY(args.y);
                const text = args.text || '';
                const pressEnter = args.press_enter !== false; // Default true
                const clearFirst = args.clear_before_typing !== false; // Default true

                await this.page.mouse.click(typeX, typeY);

                if (clearFirst) {
                    // Select all and delete
                    await this.page.keyboard.press('Control+A');
                    await this.page.keyboard.press('Backspace');
                }

                await this.page.keyboard.type(text, { delay: 30 });

                if (pressEnter) {
                    await this.page.keyboard.press('Enter');
                }
                break;

            case 'key_combination':
                const keys = args.keys || '';
                await this.page.keyboard.press(keys);
                break;

            case 'scroll_document':
                const scrollDir = args.direction || 'down';
                const scrollAmount = scrollDir === 'up' || scrollDir === 'left' ? -500 : 500;
                if (scrollDir === 'up' || scrollDir === 'down') {
                    await this.page.mouse.wheel(0, scrollAmount);
                } else {
                    await this.page.mouse.wheel(scrollAmount, 0);
                }
                break;

            case 'scroll_at':
                const scrollAtX = this.denormalizeX(args.x);
                const scrollAtY = this.denormalizeY(args.y);
                const magnitude = args.magnitude || 800;
                const dir = args.direction || 'down';

                await this.page.mouse.move(scrollAtX, scrollAtY);
                const scrollDelta = dir === 'up' || dir === 'left' ? -magnitude : magnitude;
                if (dir === 'up' || dir === 'down') {
                    await this.page.mouse.wheel(0, this.denormalizeY(scrollDelta));
                } else {
                    await this.page.mouse.wheel(this.denormalizeX(scrollDelta), 0);
                }
                break;

            case 'drag_and_drop':
                const startX = this.denormalizeX(args.x);
                const startY = this.denormalizeY(args.y);
                const endX = this.denormalizeX(args.destination_x);
                const endY = this.denormalizeY(args.destination_y);

                await this.page.mouse.move(startX, startY);
                await this.page.mouse.down();
                await this.page.mouse.move(endX, endY);
                await this.page.mouse.up();
                break;

            default:
                this.logger.warn(`Unknown action: ${fname}`);
        }
    }

    /**
     * Extract visible product information from the current page
     * Uses page evaluation to find price-related elements
     */
    async extractVisibleProducts() {
        try {
            const products = await this.page.evaluate(() => {
                const results = [];

                // Look for Google Shopping product cards
                const shoppingCards = document.querySelectorAll('[data-docid], .sh-dgr__content, .sh-dlr__list-result');

                shoppingCards.forEach(card => {
                    const nameEl = card.querySelector('h3, .tAxDx, [data-name]');
                    const priceEl = card.querySelector('[data-price], .a8Pemb, .kHxwFf');
                    const storeEl = card.querySelector('.aULzUe, .E5ocAb, .IuHnof');
                    const linkEl = card.querySelector('a[href]');

                    if (priceEl) {
                        const priceText = priceEl.textContent || '';
                        const priceMatch = priceText.match(/[\d,.]+/);
                        const price = priceMatch ? parseFloat(priceMatch[0].replace(',', '.')) : null;

                        if (price) {
                            results.push({
                                product_name: nameEl?.textContent?.trim() || 'Unknown Product',
                                price: price,
                                currency: priceText.includes('$') ? 'USD' : 'EUR',
                                store_name: storeEl?.textContent?.trim() || 'Unknown Store',
                                source_url: linkEl?.href || null,
                                availability: 'in_stock',
                            });
                        }
                    }
                });

                // Also look for general product listings
                const priceElements = document.querySelectorAll('[class*="price"], [data-price]');
                priceElements.forEach(el => {
                    const priceText = el.textContent || '';
                    const priceMatch = priceText.match(/€?\s*([\d,.]+)\s*€?/);
                    if (priceMatch && results.length < 20) {
                        const parent = el.closest('article, .product, [data-product], li');
                        const nameEl = parent?.querySelector('h2, h3, .title, [class*="name"]');
                        const linkEl = parent?.querySelector('a[href]');

                        if (nameEl) {
                            results.push({
                                product_name: nameEl.textContent?.trim() || 'Unknown',
                                price: parseFloat(priceMatch[1].replace(',', '.')),
                                currency: 'EUR',
                                store_name: window.location.hostname,
                                source_url: linkEl?.href || window.location.href,
                                availability: 'in_stock',
                            });
                        }
                    }
                });

                return results;
            });

            return products;
        } catch (error) {
            this.logger.warn('Could not extract products from page', { error: error.message });
            return [];
        }
    }

    /**
     * Parse text response for product data
     */
    parseTextForProducts(text) {
        const products = [];
        // Try to extract structured data from model's text response
        const priceMatches = text.matchAll(/([^,\n]+?)\s*[-–:]\s*€?\s*([\d,.]+)\s*€?\s*(?:[-–]\s*([^,\n]+))?/g);

        for (const match of priceMatches) {
            products.push({
                product_name: match[1]?.trim() || 'Unknown',
                price: parseFloat(match[2].replace(',', '.')),
                currency: 'EUR',
                store_name: match[3]?.trim() || 'Unknown Store',
                availability: 'in_stock',
            });
        }

        return products;
    }

    /**
     * Remove duplicate products
     */
    deduplicateResults(results) {
        const seen = new Set();
        return results.filter(r => {
            const key = `${r.product_name}-${r.price}-${r.store_name}`;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });
    }

    /**
     * Save screenshot to file
     */
    async saveScreenshot(name) {
        const filename = `${name}_${Date.now()}.png`;
        const filepath = path.join(config.screenshotsDir, filename);
        await this.page.screenshot({ path: filepath });
        return filepath;
    }

    /**
     * Cleanup browser resources
     */
    async cleanup() {
        if (this.browser) {
            // If running with UI (not headless), wait a bit before closing
            // so the user can see what happened/debug errors
            if (config.headless === false) {
                this.logger.info('Waiting 10s before closing browser for debugging...');
                await new Promise(resolve => setTimeout(resolve, 10000));
            }

            await this.browser.close();
            this.browser = null;
            this.context = null;
            this.page = null;
        }
    }
    /**
     * Helper to generate content with retry logic for 429 errors
     */
    async generateContentWithRetry(contents, maxRetries = 3) {
        let retries = 0;
        while (true) {
            try {
                return await this.model.generateContent({ contents });
            } catch (error) {
                // Check for 429 or 503 (service unavailable) which is often transient
                if (error.message.includes('429') || error.status === 429 || error.status === 503) {
                    retries++;
                    if (retries > maxRetries) throw error;

                    // Exponential backoff: 2s, 4s, 8s... + jitter
                    const delay = Math.pow(2, retries) * 1000 + (Math.random() * 1000);
                    this.logger.warn(`Quota exceeded or Service Unavailable (429/503). Retrying in ${Math.round(delay)}ms...`);
                    await new Promise(resolve => setTimeout(resolve, delay));
                } else {
                    throw error;
                }
            }
        }
    }
}

/**
 * Mock Computer Use Agent for dry-run mode
 */
export class MockComputerUseAgent {
    async executeTask(goal, taskId) {
        const logger = createTaskLogger(taskId, 'MockComputerUseAgent');
        logger.info('Mock Computer Use execution', { goal });

        // Simulate processing time
        await new Promise(resolve => setTimeout(resolve, 1500));

        // Return realistic mock results based on goal
        const mockResults = [];
        const timestamp = Date.now();

        if (goal.toLowerCase().includes('tomir')) {
            // Simulate Google Shopping results for Tomir 02
            mockResults.push(
                {
                    product_name: 'NNormal Tomir 02',
                    price: 145.00,
                    currency: 'EUR',
                    store_name: 'i-Run.pt',
                    source_url: 'https://www.i-run.pt/nnormal-tomir-02',
                    availability: 'in_stock',
                    screenshot_path: `mock_screenshot_${timestamp}_1.png`,
                },
                {
                    product_name: 'NNormal Tomir 02 Homem',
                    price: 145.00,
                    currency: 'EUR',
                    store_name: 'i-Run.pt',
                    source_url: 'https://www.i-run.pt/nnormal-tomir-02-homem',
                    availability: 'in_stock',
                    screenshot_path: `mock_screenshot_${timestamp}_1.png`,
                },
                {
                    product_name: 'Nnormal Tomir 2.0 Size 42',
                    price: 136.11,
                    currency: 'EUR',
                    store_name: 'Runkd.com',
                    source_url: 'https://www.runkd.com/nnormal-tomir-2',
                    availability: 'in_stock',
                    screenshot_path: `mock_screenshot_${timestamp}_1.png`,
                },
                {
                    product_name: 'Nnormal Tomir 2.0 GTX Unisex',
                    price: 189.95,
                    currency: 'EUR',
                    store_name: 'Zalando PT',
                    source_url: 'https://www.zalando.pt/nnormal-tomir-gtx',
                    availability: 'in_stock',
                    screenshot_path: `mock_screenshot_${timestamp}_1.png`,
                },
                {
                    product_name: 'Sapatilhas NNormal Tomir',
                    price: 170.00,
                    currency: 'EUR',
                    store_name: 'Deporvillage',
                    source_url: 'https://www.deporvillage.com/nnormal-tomir',
                    availability: 'in_stock',
                    screenshot_path: `mock_screenshot_${timestamp}_1.png`,
                }
            );
        }

        if (goal.toLowerCase().includes('kjerag')) {
            mockResults.push(
                {
                    product_name: 'NNormal Kjerag 02',
                    price: 190.00,
                    currency: 'EUR',
                    store_name: 'NNormal',
                    source_url: 'https://www.nnormal.com/es_ES/kjerag-02',
                    availability: 'in_stock',
                    screenshot_path: `mock_screenshot_${timestamp}_1.png`,
                }
            );
        }

        // Default mock result if no matches
        if (mockResults.length === 0) {
            mockResults.push({
                product_name: 'Mock Product',
                price: 99.99,
                currency: 'EUR',
                store_name: 'Mock Store',
                source_url: 'https://example.com',
                availability: 'in_stock',
                screenshot_path: `mock_screenshot_${timestamp}.png`,
            });
        }

        logger.info('Mock execution complete', { resultsCount: mockResults.length });

        return {
            success: true,
            results: mockResults,
            turns: 5,
        };
    }
}

/**
 * Factory function
 */
export function createComputerUseAgent() {
    if (config.dryRun || !config.geminiApiKey) {
        return new MockComputerUseAgent();
    }
    return new ComputerUseAgent();
}

export default { ComputerUseAgent, MockComputerUseAgent, createComputerUseAgent };
