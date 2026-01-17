import { GoogleGenerativeAI } from '@google/generative-ai';
import config from '../config.js';
import { createTaskLogger } from '../logger.js';
import { ParsedTaskSchema, validateSchema } from '../schemas.js';
import {
    normalizeBrand,
    normalizeColor,
    normalizeCurrency,
    normalizeSize,
    normalizeGender,
    extractSiteName,
} from '../validation/normalizers.js';

/**
 * System prompt for intent parsing
 */
const SYSTEM_PROMPT = `You are a precise intent parser for a price monitoring system. Your job is to transform natural language requests about tracking apparel prices into a structured JSON format.

CRITICAL RULES:
1. Output ONLY valid JSON, no explanations
2. NEVER invent data that wasn't in the user's request
3. If information is missing, use null
4. If you're unsure about something, reflect that in a lower confidence score
5. Normalize brands, colors, and currencies to standard forms

OUTPUT SCHEMA:
{
  "task_type": "price_monitoring",
  "product": {
    "brand": string | null,      // e.g., "Nike", "Adidas", "Patagonia"
    "model": string | null,      // e.g., "Air Force 1", "Samba", "Down Sweater"
    "category": string | null,   // e.g., "sneakers", "jacket", "t-shirt"
    "color": string | null,      // e.g., "black", "white", "navy"
    "gender": string | null      // "men", "women", "unisex", "kids"
  },
  "constraints": {
    "max_price": number | null,  // Price threshold (just the number)
    "currency": string | null,   // ISO code: "EUR", "USD", "GBP"
    "size": string | null        // e.g., "M", "42", "10.5"
  },
  "sources": {
    "mode": "google" | "specific_sites",
    "sites": string[] | null     // e.g., ["zalando", "farfetch"], null for google mode
  },
  "search_strategy": "google" | "site_internal" | null,
  "confidence": number           // 0.0 to 1.0, how confident you are in the parsing
}

PARSING GUIDELINES:
- Extract brand from mentions like "Adidas", "Nike", etc.
- Extract model from specific product names like "Samba", "Air Force 1"
- If user says "on Google" or "search online", use mode: "google"
- If user mentions specific sites like "on Zalando" or "Farfetch", use mode: "specific_sites"
- Parse prices like "under 90€" as max_price: 90, currency: "EUR"
- Infer category from context (sneakers, jacket, etc.)
- Set confidence based on how clear and complete the request is

EXAMPLES:
Input: "Let me know if Adidas Samba black drop below 90€ on Zara or Farfetch"
Output: {"task_type":"price_monitoring","product":{"brand":"Adidas","model":"Samba","category":"sneakers","color":"black","gender":null},"constraints":{"max_price":90,"currency":"EUR","size":null},"sources":{"mode":"specific_sites","sites":["zara","farfetch"]},"search_strategy":"site_internal","confidence":0.95}

Input: "Check if Nike Air Force 1 white are under 110€ by searching on Google"
Output: {"task_type":"price_monitoring","product":{"brand":"Nike","model":"Air Force 1","category":"sneakers","color":"white","gender":null},"constraints":{"max_price":110,"currency":"EUR","size":null},"sources":{"mode":"google","sites":null},"search_strategy":"google","confidence":0.92}

Input: "Find Patagonia Down Sweater jacket men size M under 250€ online"
Output: {"task_type":"price_monitoring","product":{"brand":"Patagonia","model":"Down Sweater","category":"jacket","color":null,"gender":"men"},"constraints":{"max_price":250,"currency":"EUR","size":"M"},"sources":{"mode":"google","sites":null},"search_strategy":"google","confidence":0.88}`;

/**
 * IntentParser class - transforms natural language to structured tasks using Google Gemini
 */
export class IntentParser {
    constructor() {
        const genAI = new GoogleGenerativeAI(config.geminiApiKey);
        // Use Gemini 2.0 Flash or the computer use preview model
        this.model = genAI.getGenerativeModel({
            model: config.geminiModel || 'gemini-2.0-flash',
            generationConfig: {
                temperature: 0.1,
                maxOutputTokens: 1000,
                responseMimeType: 'application/json',
            },
        });
        this.logger = createTaskLogger('intent-parser', 'IntentParser');
    }

    /**
     * Parse user input into structured task
     */
    async parse(userInput, taskId) {
        const logger = createTaskLogger(taskId, 'IntentParser');

        logger.info('Starting intent parsing with Gemini', { inputLength: userInput.length });

        try {
            // Build the prompt with system instructions and user input
            const prompt = `${SYSTEM_PROMPT}

Now parse this user request and output ONLY valid JSON:
"${userInput}"`;

            // Call Gemini API
            const result = await this.model.generateContent(prompt);
            const response = await result.response;
            const content = response.text();

            if (!content) {
                throw new Error('Empty response from Gemini');
            }

            logger.debug('Raw Gemini response', { content });

            // Parse JSON - handle potential markdown code blocks
            let jsonContent = content.trim();
            if (jsonContent.startsWith('```json')) {
                jsonContent = jsonContent.replace(/^```json\s*/, '').replace(/\s*```$/, '');
            } else if (jsonContent.startsWith('```')) {
                jsonContent = jsonContent.replace(/^```\s*/, '').replace(/\s*```$/, '');
            }

            let parsed;
            try {
                parsed = JSON.parse(jsonContent);
            } catch (e) {
                throw new Error(`Invalid JSON from Gemini: ${e.message}`);
            }

            // Normalize values
            const normalized = this.normalizeResult(parsed);

            // Validate against schema
            const validation = validateSchema(ParsedTaskSchema, normalized);

            if (!validation.valid) {
                logger.warn('Schema validation failed', { errors: validation.errors });
                throw new Error(`Schema validation failed: ${validation.errors.join(', ')}`);
            }

            logger.info('Intent parsing successful', {
                confidence: normalized.confidence,
                brand: normalized.product.brand,
                model: normalized.product.model,
            });

            return {
                success: true,
                parsedTask: validation.data,
                rawResponse: content,
            };

        } catch (error) {
            logger.error('Intent parsing failed', { error: error.message });

            return {
                success: false,
                error: error.message,
                parsedTask: null,
            };
        }
    }

    /**
     * Normalize parsed result values
     */
    normalizeResult(parsed) {
        return {
            task_type: parsed.task_type || 'price_monitoring',
            product: {
                brand: normalizeBrand(parsed.product?.brand),
                model: parsed.product?.model || null,
                category: parsed.product?.category || null,
                color: normalizeColor(parsed.product?.color),
                gender: normalizeGender(parsed.product?.gender),
            },
            constraints: {
                max_price: typeof parsed.constraints?.max_price === 'number'
                    ? parsed.constraints.max_price
                    : null,
                currency: normalizeCurrency(parsed.constraints?.currency) || 'EUR',
                size: normalizeSize(parsed.constraints?.size),
            },
            sources: {
                mode: parsed.sources?.mode || 'google',
                sites: parsed.sources?.sites?.map(s => extractSiteName(s)) || null,
            },
            search_strategy: parsed.search_strategy || null,
            confidence: typeof parsed.confidence === 'number'
                ? Math.max(0, Math.min(1, parsed.confidence))
                : 0.5,
        };
    }

    /**
     * Generate clarification questions for incomplete input
     */
    async requestClarification(parsedTask, taskId) {
        const logger = createTaskLogger(taskId, 'IntentParser');
        const questions = [];

        // Check what's missing
        if (!parsedTask.product.brand && !parsedTask.product.model) {
            questions.push('What brand or specific product are you looking for?');
        }

        if (parsedTask.sources.mode === 'specific_sites' &&
            (!parsedTask.sources.sites || parsedTask.sources.sites.length === 0)) {
            questions.push('Which websites should I search on?');
        }

        if (parsedTask.confidence < 0.5) {
            questions.push('Could you rephrase your request with more details?');
        }

        logger.info('Clarification requested', { questions });

        return {
            needsClarification: questions.length > 0,
            questions,
            partialParse: parsedTask,
        };
    }
}

/**
 * Mock intent parser for dry-run mode
 */
export class MockIntentParser {
    async parse(userInput, taskId) {
        const logger = createTaskLogger(taskId, 'MockIntentParser');
        logger.info('Mock parsing (dry-run mode)', { inputLength: userInput.length });

        // Simple regex-based parsing for testing
        const brand = this.extractPattern(userInput,
            /(nnormal|nike|adidas|puma|patagonia|zara|h&m|new balance|converse|vans)/i);
        const color = this.extractPattern(userInput,
            /(black|white|red|blue|green|grey|gray|navy|pink|brown|negro|blanco|azul)/i);
        const priceMatch = userInput.match(/(\d+)\s*€|€\s*(\d+)|under\s+(\d+)|debajo de\s+(\d+)|por debajo de\s+(\d+)/i);
        const price = priceMatch ? parseInt(priceMatch[1] || priceMatch[2] || priceMatch[3] || priceMatch[4] || priceMatch[5]) : null;

        const hasGoogle = /google|online|internet|search/i.test(userInput);
        const siteMatches = userInput.match(/(zalando|farfetch|asos|zara|h&m|sportsshoes|nnormal\.com)/gi);

        // Detect direct URLs in the input
        const urlMatch = userInput.match(/https?:\/\/(?:www\.)?([a-zA-Z0-9-]+(?:\.[a-zA-Z]{2,})+)/i);
        const directUrl = urlMatch ? urlMatch[0] : null;
        const directSite = urlMatch ? urlMatch[1].replace(/\.[^.]+$/, '') : null; // Extract domain name

        const parsedTask = {
            task_type: 'price_monitoring',
            product: {
                brand: normalizeBrand(brand),
                model: this.extractModel(userInput),
                category: this.extractCategory(userInput),
                color: normalizeColor(color),
                gender: this.extractGender(userInput),
            },
            constraints: {
                max_price: price,
                currency: 'EUR',
                size: this.extractSize(userInput),
            },
            sources: {
                mode: directUrl ? 'direct_url' : (siteMatches && siteMatches.length > 0 ? 'specific_sites' : 'google'),
                sites: directUrl ? [directSite] : (siteMatches ? siteMatches.map(s => s.toLowerCase()) : null),
                url: directUrl, // Store the full URL for direct navigation
            },
            search_strategy: hasGoogle ? 'google' : 'site_internal',
            confidence: brand ? 0.75 : 0.5,
        };

        logger.info('Mock parsing complete', {
            brand: parsedTask.product.brand,
            confidence: parsedTask.confidence
        });

        return {
            success: true,
            parsedTask,
            rawResponse: JSON.stringify(parsedTask),
        };
    }

    extractPattern(text, regex) {
        const match = text.match(regex);
        return match ? match[1] : null;
    }

    extractModel(text) {
        // Common model patterns - including NNORMAL models
        const models = [
            // NNORMAL models
            'Tomir 02 Gore-Tex', 'Tomir 02 GTX', 'Tomir 02', 'Tomir',
            'Kjerag 02', 'Kjerag Brut', 'Kjerag',
            'Kboix 01', 'Kboix',
            // Nike models
            'Air Force 1', 'Air Max', 'Air Jordan', 'Dunk', 'Blazer',
            // Adidas models
            'Samba', 'Stan Smith', 'Superstar', 'Gazelle', 'Ultraboost',
            // Outdoor brands
            'Down Sweater', 'Nano Puff', 'Nuptse', '574', '990', '550',
        ];

        for (const model of models) {
            if (text.toLowerCase().includes(model.toLowerCase())) {
                return model;
            }
        }
        return null;
    }

    extractCategory(text) {
        const categories = {
            'sneakers': ['sneaker', 'shoe', 'trainer', 'kick'],
            'jacket': ['jacket', 'coat', 'puffer', 'down'],
            't-shirt': ['t-shirt', 'tee', 'shirt'],
            'hoodie': ['hoodie', 'sweatshirt', 'sweater'],
            'jeans': ['jeans', 'denim'],
            'dress': ['dress'],
            'pants': ['pants', 'trousers'],
        };

        const lowerText = text.toLowerCase();
        for (const [category, keywords] of Object.entries(categories)) {
            if (keywords.some(kw => lowerText.includes(kw))) {
                return category;
            }
        }
        return null;
    }

    extractGender(text) {
        const lowerText = text.toLowerCase();
        if (/\b(men|man|male|mens|men's)\b/.test(lowerText)) return 'men';
        if (/\b(women|woman|female|womens|women's)\b/.test(lowerText)) return 'women';
        if (/\b(kid|kids|children|child)\b/.test(lowerText)) return 'kids';
        return null;
    }

    extractSize(text) {
        const sizeMatch = text.match(/\bsize\s*(\w+)\b/i) ||
            text.match(/\b(XS|S|M|L|XL|XXL)\b/i) ||
            text.match(/\b(\d{1,2}(?:\.\d)?)\b/);
        return sizeMatch ? normalizeSize(sizeMatch[1]) : null;
    }

    async requestClarification(parsedTask, taskId) {
        const questions = [];

        if (!parsedTask.product.brand && !parsedTask.product.model) {
            questions.push('What brand or product are you looking for?');
        }

        return {
            needsClarification: questions.length > 0,
            questions,
            partialParse: parsedTask,
        };
    }
}

/**
 * Factory function to create appropriate parser
 */
export function createIntentParser() {
    if (config.dryRun || !config.geminiApiKey) {
        return new MockIntentParser();
    }
    return new IntentParser();
}

export default { IntentParser, MockIntentParser, createIntentParser };
