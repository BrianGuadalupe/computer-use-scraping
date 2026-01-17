import 'dotenv/config';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import YAML from 'yaml';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

/**
 * Load YAML configuration file
 */
function loadYamlConfig(filename) {
    const configPath = path.join(ROOT_DIR, 'configs', filename);
    if (!fs.existsSync(configPath)) {
        return null;
    }
    const content = fs.readFileSync(configPath, 'utf-8');
    return YAML.parse(content);
}

/**
 * Ensure directory exists
 */
function ensureDir(dirPath) {
    if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
    }
    return dirPath;
}

/**
 * Application configuration
 */
export const config = {
    // Server
    port: parseInt(process.env.PORT || '3000', 10),
    host: process.env.HOST || 'localhost',

    // API Keys - Google Gemini
    geminiApiKey: process.env.GEMINI_API_KEY || '',
    // Default model for intent parsing; Computer Use agent uses gemini-2.5-computer-use-preview-10-2025
    geminiModel: process.env.GEMINI_MODEL || 'gemini-2.0-flash',

    // Modes
    dryRun: process.env.DRY_RUN === 'true',
    debugMode: process.env.DEBUG_MODE === 'true',

    // Browser
    headless: process.env.HEADLESS !== 'false',
    slowMo: parseInt(process.env.SLOW_MO || '0', 10),

    // Rate limiting
    defaultRateLimit: parseInt(process.env.DEFAULT_RATE_LIMIT || '5000', 10),

    // Logging
    logLevel: process.env.LOG_LEVEL || 'info',

    // Directories
    rootDir: ROOT_DIR,
    outputsDir: ensureDir(path.join(ROOT_DIR, 'outputs')),
    resultsDir: ensureDir(path.join(ROOT_DIR, 'outputs', 'results')),
    screenshotsDir: ensureDir(path.join(ROOT_DIR, 'outputs', 'screenshots')),
    logsDir: ensureDir(path.join(ROOT_DIR, 'logs')),
    dataDir: ensureDir(path.join(ROOT_DIR, 'data')),

    // Loaded configs
    sites: loadYamlConfig('sites.yaml') || { sites: {} },
    brands: loadYamlConfig('brands.yaml') || { brands: {} },
    currencies: loadYamlConfig('currencies.yaml') || { currencies: {} },

    // Validation thresholds
    minConfidence: 0.6,
    maxRetries: 3,
    // Legacy timeout for non-Computer Use requests
    requestTimeout: 30000,

    // Computer Use settings
    useComputerUse: process.env.USE_COMPUTER_USE === 'true',
    computerUseMaxSteps: parseInt(process.env.COMPUTER_USE_MAX_STEPS || '20', 10),
    // Timeout for Computer Use requests (99% confidence calculation):
    // Intent parsing: 4s + Browser init: 5s + (turns × 13s/turn) + 30s margin
    // For 20 turns: 4 + 5 + (20 × 13) + 30 = 299s ≈ 300s (5 min)
    computerUseTimeout: parseInt(process.env.COMPUTER_USE_TIMEOUT || '300000', 10),
};

/**
 * Validate required configuration
 */
export function validateConfig() {
    const errors = [];

    if (!config.geminiApiKey && !config.dryRun) {
        errors.push('GEMINI_API_KEY is required for production mode');
    }

    if (errors.length > 0) {
        return { valid: false, errors };
    }

    return { valid: true, errors: [] };
}

export default config;
