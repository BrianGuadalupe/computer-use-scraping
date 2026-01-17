import { chromium } from 'playwright';
import path from 'path';
import config from '../config.js';
import { createTaskLogger } from '../logger.js';
import { TaskStatus } from '../schemas.js';
import { parsePrice, buildSearchQuery } from '../validation/normalizers.js';

/**
 * Generate random delay for human-like behavior
 */
function randomDelay(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * Browser Agent - handles all browser automation tasks
 */
export class BrowserAgent {
    constructor() {
        this.browser = null;
        this.context = null;
        this.page = null;
        this.logger = createTaskLogger('browser-agent', 'BrowserAgent');
    }

    /**
     * Initialize browser instance
     */
    async initialize(taskId) {
        const logger = createTaskLogger(taskId, 'BrowserAgent');

        logger.info('Initializing browser');

        try {
            this.browser = await chromium.launch({
                headless: config.headless,
                slowMo: config.debugMode ? 100 : config.slowMo,
                args: [
                    '--disable-blink-features=AutomationControlled',
                    '--disable-dev-shm-usage',
                    '--no-sandbox',
                ],
            });

            this.context = await this.browser.newContext({
                viewport: { width: 1366, height: 768 },
                userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                locale: 'en-US',
                timezoneId: 'Europe/London',
            });

            this.page = await this.context.newPage();

            // Add stealth modifications
            await this.page.addInitScript(() => {
                Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
            });

            logger.info('Browser initialized successfully');
            return true;

        } catch (error) {
            logger.error('Browser initialization failed', { error: error.message });
            throw error;
        }
    }

    /**
     * Close browser instance
     */
    async close() {
        if (this.browser) {
            await this.browser.close();
            this.browser = null;
            this.context = null;
            this.page = null;
        }
    }

    /**
     * Human-like text typing
     */
    async humanType(selector, text) {
        const element = await this.page.waitForSelector(selector, { timeout: 10000 });
        await element.click();
        await this.page.waitForTimeout(randomDelay(200, 500));

        // Type character by character with random delays
        for (const char of text) {
            await element.type(char, { delay: randomDelay(50, 150) });
        }

        await this.page.waitForTimeout(randomDelay(300, 600));
    }

    /**
     * Human-like scrolling
     */
    async humanScroll(distance = 300) {
        await this.page.evaluate((scrollDistance) => {
            window.scrollBy({
                top: scrollDistance,
                behavior: 'smooth'
            });
        }, distance);
        await this.page.waitForTimeout(randomDelay(500, 1000));
    }

    /**
     * Handle cookie consent banners
     */
    async handleCookieBanner() {
        const cookieSelectors = [
            '#onetrust-accept-btn-handler',
            '[data-testid="cookie-banner-accept"]',
            '#uc-btn-accept-banner',
            '.cookie-accept',
            '[aria-label="Accept cookies"]',
            'button:has-text("Accept")',
            'button:has-text("Accept All")',
            'button:has-text("Accept all")',
            'button:has-text("I Accept")',
            'button:has-text("Got it")',
        ];

        for (const selector of cookieSelectors) {
            try {
                const button = await this.page.$(selector);
                if (button && await button.isVisible()) {
                    await button.click();
                    await this.page.waitForTimeout(randomDelay(500, 1000));
                    this.logger.debug('Cookie banner dismissed', { selector });
                    return true;
                }
            } catch {
                // Continue trying other selectors
            }
        }

        return false;
    }

    /**
     * Detect CAPTCHA presence
     */
    async detectCaptcha() {
        const captchaIndicators = [
            'iframe[src*="recaptcha"]',
            'iframe[src*="captcha"]',
            '.g-recaptcha',
            '#captcha',
            '[class*="captcha"]',
            'text="verify you are human"',
            'text="robot"',
        ];

        for (const indicator of captchaIndicators) {
            try {
                const element = await this.page.$(indicator);
                if (element) {
                    return true;
                }
            } catch {
                // Continue checking
            }
        }

        return false;
    }

    /**
     * Navigate to URL with retry logic
     */
    async navigateTo(url, taskId) {
        const logger = createTaskLogger(taskId, 'BrowserAgent');

        logger.info('Navigating to URL', { url });

        try {
            const response = await this.page.goto(url, {
                waitUntil: 'domcontentloaded',
                timeout: config.requestTimeout,
            });

            await this.page.waitForTimeout(randomDelay(1000, 2000));

            // Handle cookie banner
            await this.handleCookieBanner();

            // Check for CAPTCHA
            if (await this.detectCaptcha()) {
                logger.warn('CAPTCHA detected');
                return { success: false, status: TaskStatus.CAPTCHA };
            }

            // Check for blocking
            const statusCode = response?.status() || 200;
            if (statusCode === 403 || statusCode === 429) {
                logger.warn('Access blocked', { statusCode });
                return { success: false, status: TaskStatus.BLOCKED };
            }

            return { success: true, status: TaskStatus.OK };

        } catch (error) {
            if (error.message.includes('Timeout')) {
                return { success: false, status: TaskStatus.TIMEOUT };
            }
            throw error;
        }
    }

    /**
     * Capture screenshot
     */
    async captureScreenshot(taskId, name) {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const filename = `${taskId}_${name}_${timestamp}.png`;
        const filepath = path.join(config.screenshotsDir, filename);

        await this.page.screenshot({
            path: filepath,
            fullPage: false,
        });

        this.logger.debug('Screenshot captured', { filepath });
        return filepath;
    }

    /**
     * Extract price from page using multiple strategies
     */
    async extractPrice(selectors, taskId) {
        const logger = createTaskLogger(taskId, 'BrowserAgent');

        // Strategy 1: Use provided selectors
        if (selectors?.price) {
            try {
                const element = await this.page.$(selectors.price);
                if (element) {
                    const text = await element.textContent();
                    const { amount, currency } = parsePrice(text);
                    if (amount) {
                        logger.debug('Price extracted via selector', { amount, currency });
                        return { amount, currency, method: 'selector' };
                    }
                }
            } catch (e) {
                logger.debug('Selector extraction failed', { error: e.message });
            }
        }

        // Strategy 2: Look for common price patterns
        const pricePatterns = [
            '[class*="price"]',
            '[data-testid*="price"]',
            '[itemprop="price"]',
            '.product-price',
            '.current-price',
            '.sale-price',
        ];

        for (const pattern of pricePatterns) {
            try {
                const elements = await this.page.$$(pattern);
                for (const element of elements) {
                    const text = await element.textContent();
                    const { amount, currency } = parsePrice(text);
                    if (amount) {
                        logger.debug('Price extracted via heuristic', { pattern, amount, currency });
                        return { amount, currency, method: 'heuristic' };
                    }
                }
            } catch {
                // Continue to next pattern
            }
        }

        // Strategy 3: Search visible text for price patterns
        try {
            const bodyText = await this.page.textContent('body');
            const priceRegex = /(?:€|EUR|USD|\$|£|GBP)\s*(\d+(?:[.,]\d{2})?)|(\d+(?:[.,]\d{2})?)\s*(?:€|EUR|USD|\$|£|GBP)/g;
            const matches = [...bodyText.matchAll(priceRegex)];

            if (matches.length > 0) {
                const match = matches[0];
                const priceStr = match[1] || match[2];
                const { amount, currency } = parsePrice(match[0]);
                if (amount) {
                    logger.debug('Price extracted via regex', { amount, currency });
                    return { amount, currency, method: 'regex' };
                }
            }
        } catch {
            // Fallback failed
        }

        logger.warn('Could not extract price');
        return { amount: null, currency: null, method: null };
    }

    /**
     * Extract product name from page
     */
    async extractProductName(selectors) {
        const namePatterns = [
            selectors?.product_name,
            'h1',
            '[data-testid*="product-name"]',
            '[class*="product-name"]',
            '[class*="product-title"]',
            '[itemprop="name"]',
        ].filter(Boolean);

        for (const pattern of namePatterns) {
            try {
                const element = await this.page.$(pattern);
                if (element) {
                    const text = await element.textContent();
                    if (text && text.trim().length > 0) {
                        return text.trim();
                    }
                }
            } catch {
                // Continue to next pattern
            }
        }

        // Fallback to title tag
        const title = await this.page.title();
        return title || 'Unknown Product';
    }

    /**
     * Extract availability status
     */
    async extractAvailability() {
        const inStockIndicators = [
            'text="In Stock"',
            'text="in stock"',
            'text="Available"',
            'text="Add to cart"',
            'text="Add to bag"',
            '[class*="in-stock"]',
            '[data-available="true"]',
        ];

        const outOfStockIndicators = [
            'text="Out of Stock"',
            'text="Sold Out"',
            'text="Unavailable"',
            'text="Not Available"',
            '[class*="out-of-stock"]',
            '[class*="sold-out"]',
        ];

        for (const indicator of outOfStockIndicators) {
            try {
                const element = await this.page.$(indicator);
                if (element && await element.isVisible()) {
                    return 'out_of_stock';
                }
            } catch {
                // Continue checking
            }
        }

        for (const indicator of inStockIndicators) {
            try {
                const element = await this.page.$(indicator);
                if (element && await element.isVisible()) {
                    return 'in_stock';
                }
            } catch {
                // Continue checking
            }
        }

        return 'unknown';
    }

    /**
     * Perform search on a site
     */
    async performSearch(siteConfig, searchQuery, taskId) {
        const logger = createTaskLogger(taskId, 'BrowserAgent');

        // Build search URL
        const searchUrl = siteConfig.search_url.replace('{query}', encodeURIComponent(searchQuery));

        logger.info('Performing search', { site: siteConfig.name, query: searchQuery });

        // Navigate to search URL
        const navResult = await this.navigateTo(searchUrl, taskId);
        if (!navResult.success) {
            return navResult;
        }

        // Wait for results to load
        await this.page.waitForTimeout(randomDelay(2000, 3000));
        await this.humanScroll(200);

        return { success: true, status: TaskStatus.OK };
    }

    /**
     * Execute a complete scraping task
     */
    async executeTask(parsedTask, taskId) {
        const logger = createTaskLogger(taskId, 'BrowserAgent');
        const results = [];
        const errors = [];

        try {
            await this.initialize(taskId);

            const searchQuery = buildSearchQuery(parsedTask.product);
            logger.info('Starting task execution', { searchQuery });

            if (parsedTask.sources.mode === 'google') {
                // Google Shopping search
                const result = await this.searchGoogle(searchQuery, parsedTask, taskId);
                if (result) results.push(...result);
            } else {
                // Search specific sites
                for (const siteName of parsedTask.sources.sites || []) {
                    try {
                        const siteConfig = config.sites.sites?.[siteName];
                        if (!siteConfig) {
                            logger.warn('Unknown site, using generic approach', { site: siteName });
                            continue;
                        }

                        // Rate limiting
                        await this.page.waitForTimeout(siteConfig.rate_limit || config.defaultRateLimit);

                        const result = await this.searchSite(siteConfig, searchQuery, parsedTask, taskId);
                        if (result) {
                            results.push(result);
                        }

                    } catch (error) {
                        logger.error('Site search failed', { site: siteName, error: error.message });
                        errors.push(`${siteName}: ${error.message}`);
                    }
                }
            }

            return {
                status: results.length > 0 ? TaskStatus.OK : TaskStatus.NOT_FOUND,
                results,
                errors,
            };

        } catch (error) {
            logger.error('Task execution failed', { error: error.message });

            // Capture failure screenshot
            if (this.page) {
                await this.captureScreenshot(taskId, 'error');
            }

            return {
                status: TaskStatus.TIMEOUT,
                results: [],
                errors: [error.message],
            };

        } finally {
            await this.close();
        }
    }

    /**
     * Search Google Shopping
     */
    async searchGoogle(searchQuery, parsedTask, taskId) {
        const logger = createTaskLogger(taskId, 'BrowserAgent');
        const results = [];

        const googleConfig = config.sites.sites?.google;
        if (!googleConfig) {
            logger.warn('Google config not found');
            return results;
        }

        const searchResult = await this.performSearch(googleConfig, searchQuery, taskId);
        if (!searchResult.success) {
            return results;
        }

        // Extract search results
        try {
            const resultElements = await this.page.$$('[data-docid], .sh-dgr__content');

            for (let i = 0; i < Math.min(resultElements.length, 5); i++) {
                const element = resultElements[i];

                try {
                    const priceText = await element.$eval('.a8Pemb, [class*="price"]', el => el.textContent).catch(() => null);
                    const nameText = await element.$eval('.tAxDx, [class*="title"]', el => el.textContent).catch(() => 'Unknown');
                    const linkHref = await element.$eval('a', el => el.href).catch(() => null);

                    if (priceText) {
                        const { amount, currency } = parsePrice(priceText);

                        if (amount) {
                            const meetsCriteria = parsedTask.constraints.max_price
                                ? amount <= parsedTask.constraints.max_price
                                : true;

                            results.push({
                                product_name: nameText?.trim() || 'Unknown',
                                current_price: amount,
                                currency: currency || parsedTask.constraints.currency || 'EUR',
                                availability: 'unknown',
                                selected_size: null,
                                timestamp: new Date().toISOString(),
                                source_url: linkHref || this.page.url(),
                                screenshot_path: null,
                                meets_criteria: meetsCriteria,
                            });
                        }
                    }
                } catch (e) {
                    logger.debug('Result extraction failed', { error: e.message });
                }
            }

            // Capture screenshot
            if (results.length > 0) {
                const screenshotPath = await this.captureScreenshot(taskId, 'google_results');
                results.forEach(r => r.screenshot_path = screenshotPath);
            }

        } catch (error) {
            logger.error('Google results extraction failed', { error: error.message });
        }

        return results;
    }

    /**
     * Search a specific site
     */
    async searchSite(siteConfig, searchQuery, parsedTask, taskId) {
        const logger = createTaskLogger(taskId, 'BrowserAgent');

        const searchResult = await this.performSearch(siteConfig, searchQuery, taskId);
        if (!searchResult.success) {
            return {
                product_name: 'Search failed',
                current_price: 0,
                currency: parsedTask.constraints.currency || 'EUR',
                availability: 'unknown',
                selected_size: null,
                timestamp: new Date().toISOString(),
                source_url: this.page.url(),
                screenshot_path: await this.captureScreenshot(taskId, `${siteConfig.name}_error`),
                meets_criteria: false,
                error: searchResult.status,
            };
        }

        // Try to find first relevant product
        const resultContainer = siteConfig.selectors?.result_container;
        let productLink = null;

        if (resultContainer) {
            try {
                const firstResult = await this.page.$(resultContainer);
                if (firstResult) {
                    const link = await firstResult.$('a');
                    if (link) {
                        productLink = await link.getAttribute('href');
                    }
                }
            } catch {
                // Use current page
            }
        }

        // Navigate to product page if found
        if (productLink) {
            const fullUrl = productLink.startsWith('http')
                ? productLink
                : new URL(productLink, this.page.url()).href;

            await this.page.waitForTimeout(randomDelay(1000, 2000));
            await this.navigateTo(fullUrl, taskId);
            await this.page.waitForTimeout(randomDelay(1500, 2500));
        }

        // Extract product info
        const { amount, currency } = await this.extractPrice(siteConfig.selectors, taskId);
        const productName = await this.extractProductName(siteConfig.selectors);
        const availability = await this.extractAvailability();
        const screenshotPath = await this.captureScreenshot(taskId, siteConfig.name.toLowerCase().replace(/\s+/g, '_'));

        const meetsCriteria = parsedTask.constraints.max_price && amount
            ? amount <= parsedTask.constraints.max_price
            : amount !== null;

        logger.info('Extraction complete', {
            site: siteConfig.name,
            price: amount,
            meetsCriteria
        });

        return {
            product_name: productName,
            current_price: amount || 0,
            currency: currency || parsedTask.constraints.currency || 'EUR',
            availability,
            selected_size: parsedTask.constraints.size,
            timestamp: new Date().toISOString(),
            source_url: this.page.url(),
            screenshot_path: screenshotPath,
            meets_criteria: meetsCriteria,
        };
    }
}

/**
 * Mock browser agent for dry-run mode
 */
export class MockBrowserAgent {
    async executeTask(parsedTask, taskId) {
        const logger = createTaskLogger(taskId, 'MockBrowserAgent');

        logger.info('Mock task execution (dry-run mode)');

        const searchQuery = buildSearchQuery(parsedTask.product);

        // Generate mock results
        const results = [];
        const sites = parsedTask.sources.mode === 'google'
            ? ['Google Shopping']
            : (parsedTask.sources.sites || ['unknown']);

        for (const site of sites) {
            // Simulate random price within reasonable range
            const basePrice = parsedTask.constraints.max_price || 100;
            const mockPrice = Math.round((basePrice * (0.7 + Math.random() * 0.5)) * 100) / 100;

            results.push({
                product_name: `${parsedTask.product.brand || ''} ${parsedTask.product.model || searchQuery}`.trim(),
                current_price: mockPrice,
                currency: parsedTask.constraints.currency || 'EUR',
                availability: Math.random() > 0.3 ? 'in_stock' : 'out_of_stock',
                selected_size: parsedTask.constraints.size,
                timestamp: new Date().toISOString(),
                source_url: `https://example.com/mock/${site.toLowerCase()}`,
                screenshot_path: null,
                meets_criteria: parsedTask.constraints.max_price
                    ? mockPrice <= parsedTask.constraints.max_price
                    : true,
            });
        }

        logger.info('Mock results generated', { count: results.length });

        return {
            status: TaskStatus.OK,
            results,
            errors: [],
        };
    }
}

/**
 * Factory function to create appropriate agent
 */
export function createBrowserAgent() {
    if (config.dryRun) {
        return new MockBrowserAgent();
    }
    return new BrowserAgent();
}

export default { BrowserAgent, MockBrowserAgent, createBrowserAgent };
