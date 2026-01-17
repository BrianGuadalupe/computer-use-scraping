import config from '../config.js';

/**
 * Normalize brand name to canonical form
 */
export function normalizeBrand(input) {
    if (!input) return null;

    const normalized = input.toLowerCase().trim();
    const { brands } = config.brands;

    for (const [key, brandConfig] of Object.entries(brands)) {
        if (brandConfig.canonical.toLowerCase() === normalized) {
            return brandConfig.canonical;
        }
        if (brandConfig.aliases?.some(alias => alias.toLowerCase() === normalized)) {
            return brandConfig.canonical;
        }
    }

    // Return original with proper capitalization if not found
    return input.charAt(0).toUpperCase() + input.slice(1).toLowerCase();
}

/**
 * Normalize color names
 */
const COLOR_MAP = {
    'black': 'Black',
    'negro': 'Black',
    'noir': 'Black',
    'schwarz': 'Black',
    'white': 'White',
    'blanco': 'White',
    'blanc': 'White',
    'weiss': 'White',
    'weiß': 'White',
    'red': 'Red',
    'rojo': 'Red',
    'rouge': 'Red',
    'rot': 'Red',
    'blue': 'Blue',
    'azul': 'Blue',
    'bleu': 'Blue',
    'blau': 'Blue',
    'green': 'Green',
    'verde': 'Green',
    'vert': 'Green',
    'grün': 'Green',
    'yellow': 'Yellow',
    'amarillo': 'Yellow',
    'jaune': 'Yellow',
    'gelb': 'Yellow',
    'pink': 'Pink',
    'rosa': 'Pink',
    'rose': 'Pink',
    'brown': 'Brown',
    'marrón': 'Brown',
    'marron': 'Brown',
    'braun': 'Brown',
    'grey': 'Grey',
    'gray': 'Grey',
    'gris': 'Grey',
    'grau': 'Grey',
    'beige': 'Beige',
    'navy': 'Navy',
    'orange': 'Orange',
    'purple': 'Purple',
    'cream': 'Cream',
    'tan': 'Tan',
    'olive': 'Olive',
    'burgundy': 'Burgundy',
    'multicolor': 'Multicolor',
    'multi': 'Multicolor',
};

export function normalizeColor(input) {
    if (!input) return null;
    const normalized = input.toLowerCase().trim();
    return COLOR_MAP[normalized] || input.charAt(0).toUpperCase() + input.slice(1).toLowerCase();
}

/**
 * Parse and normalize currency from text
 */
export function normalizeCurrency(input) {
    if (!input) return null;

    const normalized = input.toLowerCase().trim();
    const { currencies } = config.currencies;

    for (const [code, currencyConfig] of Object.entries(currencies)) {
        if (code.toLowerCase() === normalized) {
            return code;
        }
        if (currencyConfig.symbol === input) {
            return code;
        }
        if (currencyConfig.aliases?.some(alias => alias.toLowerCase() === normalized)) {
            return code;
        }
    }

    // Try to detect from symbol
    if (input.includes('€')) return 'EUR';
    if (input.includes('$')) return 'USD';
    if (input.includes('£')) return 'GBP';

    return input.toUpperCase();
}

/**
 * Parse price from text, extracting amount and currency
 */
export function parsePrice(text) {
    if (!text) return { amount: null, currency: null };

    // Clean the text
    const cleaned = text.replace(/\s+/g, ' ').trim();

    // Common patterns
    const patterns = [
        // €99.99 or € 99,99
        /€\s*([0-9]+(?:[.,][0-9]{1,2})?)/,
        // 99.99€ or 99,99 €
        /([0-9]+(?:[.,][0-9]{1,2})?)\s*€/,
        // $99.99 or $ 99.99
        /\$\s*([0-9]+(?:[.,][0-9]{1,2})?)/,
        // 99.99$ or 99.99 $
        /([0-9]+(?:[.,][0-9]{1,2})?)\s*\$/,
        // £99.99
        /£\s*([0-9]+(?:[.,][0-9]{1,2})?)/,
        // 99.99£
        /([0-9]+(?:[.,][0-9]{1,2})?)\s*£/,
        // EUR 99.99 or 99.99 EUR
        /EUR\s*([0-9]+(?:[.,][0-9]{1,2})?)/i,
        /([0-9]+(?:[.,][0-9]{1,2})?)\s*EUR/i,
        // USD 99.99 or 99.99 USD
        /USD\s*([0-9]+(?:[.,][0-9]{1,2})?)/i,
        /([0-9]+(?:[.,][0-9]{1,2})?)\s*USD/i,
        // GBP 99.99 or 99.99 GBP
        /GBP\s*([0-9]+(?:[.,][0-9]{1,2})?)/i,
        /([0-9]+(?:[.,][0-9]{1,2})?)\s*GBP/i,
    ];

    for (const pattern of patterns) {
        const match = cleaned.match(pattern);
        if (match) {
            // Normalize the number (convert comma decimal separator to period)
            let amount = match[1].replace(',', '.');
            amount = parseFloat(amount);

            // Detect currency
            let currency = 'EUR'; // default
            if (cleaned.includes('$') || /USD/i.test(cleaned)) currency = 'USD';
            else if (cleaned.includes('£') || /GBP/i.test(cleaned)) currency = 'GBP';
            else if (cleaned.includes('€') || /EUR/i.test(cleaned)) currency = 'EUR';

            return { amount, currency };
        }
    }

    // Try to extract just a number as fallback
    const numberMatch = cleaned.match(/([0-9]+(?:[.,][0-9]{1,2})?)/);
    if (numberMatch) {
        let amount = numberMatch[1].replace(',', '.');
        return { amount: parseFloat(amount), currency: null };
    }

    return { amount: null, currency: null };
}

/**
 * Normalize size string
 */
export function normalizeSize(input) {
    if (!input) return null;

    const normalized = input.toUpperCase().trim();

    // Standard sizes
    const sizeMap = {
        'EXTRA SMALL': 'XS',
        'XSMALL': 'XS',
        'X-SMALL': 'XS',
        'SMALL': 'S',
        'MEDIUM': 'M',
        'MED': 'M',
        'LARGE': 'L',
        'EXTRA LARGE': 'XL',
        'XLARGE': 'XL',
        'X-LARGE': 'XL',
        'EXTRA EXTRA LARGE': 'XXL',
        'XXLARGE': 'XXL',
        'XX-LARGE': 'XXL',
    };

    if (sizeMap[normalized]) {
        return sizeMap[normalized];
    }

    // Already normalized or numeric
    return normalized;
}

/**
 * Normalize gender/target audience
 */
export function normalizeGender(input) {
    if (!input) return null;

    const normalized = input.toLowerCase().trim();

    const genderMap = {
        'men': 'men',
        'man': 'men',
        'male': 'men',
        'mens': 'men',
        "men's": 'men',
        'hombre': 'men',
        'homme': 'men',
        'herren': 'men',
        'women': 'women',
        'woman': 'women',
        'female': 'women',
        'womens': 'women',
        "women's": 'women',
        'mujer': 'women',
        'femme': 'women',
        'damen': 'women',
        'unisex': 'unisex',
        'kids': 'kids',
        'children': 'kids',
        'child': 'kids',
        'niños': 'kids',
        'enfants': 'kids',
        'kinder': 'kids',
    };

    return genderMap[normalized] || input;
}

/**
 * Extract site name from URL or text
 */
export function extractSiteName(input) {
    if (!input) return null;

    // Try to extract domain from URL
    try {
        const url = new URL(input.startsWith('http') ? input : `https://${input}`);
        const hostname = url.hostname.replace('www.', '');

        // Match against known sites
        const { sites } = config.sites;
        for (const [key, siteConfig] of Object.entries(sites)) {
            if (siteConfig.domains?.some(domain => hostname.includes(domain.replace('www.', '')))) {
                return key;
            }
        }

        return hostname;
    } catch {
        // Not a URL, try to match site name directly
        const normalized = input.toLowerCase().trim();
        const { sites } = config.sites;

        for (const [key, siteConfig] of Object.entries(sites)) {
            if (key === normalized || siteConfig.name?.toLowerCase() === normalized) {
                return key;
            }
        }

        return normalized;
    }
}

/**
 * Build search query from product attributes
 */
export function buildSearchQuery(product) {
    const parts = [];

    if (product.brand) parts.push(product.brand);
    if (product.model) parts.push(product.model);
    if (product.category) parts.push(product.category);
    if (product.color) parts.push(product.color);
    if (product.gender) parts.push(product.gender);

    return parts.join(' ');
}

export default {
    normalizeBrand,
    normalizeColor,
    normalizeCurrency,
    parsePrice,
    normalizeSize,
    normalizeGender,
    extractSiteName,
    buildSearchQuery,
};
