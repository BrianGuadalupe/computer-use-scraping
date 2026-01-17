import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import config, { validateConfig } from './config.js';
import logger from './logger.js';
import { getOrchestrator } from './agents/task-orchestrator.js';
import { MonitorRequestSchema, validateSchema } from './schemas.js';
import { listResultFiles } from './output/results-writer.js';
import { getScreenshotManager } from './output/screenshot-manager.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Initialize Express app
const app = express();

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));
app.use('/screenshots', express.static(config.screenshotsDir));
app.use('/results', express.static(config.resultsDir));

// Request logging middleware
app.use((req, res, next) => {
    logger.info('Request received', {
        method: req.method,
        path: req.path,
        ip: req.ip,
    });
    next();
});

/**
 * API Routes
 */

// Health check
app.get('/api/health', (req, res) => {
    res.json({
        status: 'ok',
        mode: config.dryRun ? 'dry-run' : 'live',
        debug: config.debugMode,
        timestamp: new Date().toISOString(),
    });
});

// System info
app.get('/api/info', (req, res) => {
    const screenshotStats = getScreenshotManager().getStats();
    const resultFiles = listResultFiles();

    res.json({
        version: '1.0.0',
        mode: config.dryRun ? 'dry-run' : 'live',
        debug: config.debugMode,
        confidence_threshold: config.minConfidence,
        supported_sites: Object.keys(config.sites.sites || {}),
        stats: {
            screenshots: screenshotStats,
            result_files: resultFiles.length,
        },
    });
});

// Main monitoring endpoint
app.post('/api/monitor', async (req, res) => {
    try {
        // Validate request
        const validation = validateSchema(MonitorRequestSchema, req.body);
        if (!validation.valid) {
            return res.status(400).json({
                error: 'Invalid request',
                details: validation.errors,
            });
        }

        const { query, dry_run } = validation.data;

        // Override dry-run if specified in request
        if (dry_run !== undefined) {
            config.dryRun = dry_run;
        }

        logger.info('Processing monitor request', {
            query: query.substring(0, 100),
            dryRun: config.dryRun,
        });

        // Process through orchestrator
        const orchestrator = getOrchestrator();
        const result = await orchestrator.processQuery(query);

        // Determine HTTP status based on result
        let status = 200;
        if (result.status === 'VALIDATION_FAILED') status = 400;
        else if (result.status === 'CLARIFICATION_NEEDED') status = 422;
        else if (result.status === 'NOT_FOUND') status = 404;
        else if (result.errors?.length > 0) status = 500;

        res.status(status).json(result);

    } catch (error) {
        logger.error('Monitor request failed', { error: error.message });
        res.status(500).json({
            error: 'Internal server error',
            message: error.message,
        });
    }
});

// Get active tasks
app.get('/api/tasks', (req, res) => {
    const orchestrator = getOrchestrator();
    res.json({
        tasks: orchestrator.getActiveTasks(),
    });
});

// Get task status
app.get('/api/tasks/:taskId', (req, res) => {
    const orchestrator = getOrchestrator();
    const status = orchestrator.getTaskStatus(req.params.taskId);

    if (!status) {
        return res.status(404).json({ error: 'Task not found' });
    }

    res.json(status);
});

// List screenshots
app.get('/api/screenshots', (req, res) => {
    const manager = getScreenshotManager();
    const stats = manager.getStats();
    res.json(stats);
});

// List result files
app.get('/api/results', (req, res) => {
    const files = listResultFiles();
    res.json({ files });
});

// Error handling middleware
app.use((err, req, res, next) => {
    logger.error('Unhandled error', { error: err.message, stack: err.stack });
    res.status(500).json({
        error: 'Internal server error',
        message: config.debugMode ? err.message : 'An unexpected error occurred',
    });
});

/**
 * Start server
 */
async function startServer() {
    // Validate configuration
    const configValidation = validateConfig();
    if (!configValidation.valid) {
        logger.warn('Configuration warnings', { errors: configValidation.errors });
        if (!config.dryRun) {
            console.log('\n⚠️  Running in DRY-RUN mode because OPENAI_API_KEY is not set.\n');
            config.dryRun = true;
        }
    }

    // Log startup info
    console.log(`
╔════════════════════════════════════════════════════════════╗
║                                                            ║
║   🛒  Price Monitor v1.0.0                                ║
║                                                            ║
║   Mode: ${config.dryRun ? 'DRY-RUN (no real scraping)' : 'LIVE'}                         ${config.dryRun ? '' : ' '}║
║   Debug: ${config.debugMode ? 'ON' : 'OFF'}                                           ║
║                                                            ║
╚════════════════════════════════════════════════════════════╝
  `);

    app.listen(config.port, config.host, () => {
        logger.info('Server started', {
            port: config.port,
            host: config.host,
            mode: config.dryRun ? 'dry-run' : 'live',
        });

        console.log(`🚀 Server running at http://${config.host}:${config.port}`);
        console.log(`📊 API endpoint: http://${config.host}:${config.port}/api/monitor`);
        console.log(`📁 Results: ${config.resultsDir}`);
        console.log(`📸 Screenshots: ${config.screenshotsDir}`);
        console.log('');
    });
}

// Start the server
startServer().catch(err => {
    logger.error('Failed to start server', { error: err.message });
    console.error('Failed to start server:', err);
    process.exit(1);
});

export default app;
