import fs from 'fs';
import path from 'path';
import config from '../config.js';
import { createTaskLogger } from '../logger.js';

/**
 * Write task results to CSV file
 */
async function writeCSV(task, filepath) {
    const headers = [
        'task_id',
        'timestamp',
        'product_name',
        'current_price',
        'currency',
        'availability',
        'size',
        'source_url',
        'meets_criteria',
        'screenshot_path',
    ];

    const rows = task.results.map(result => [
        task.id,
        result.timestamp,
        `"${(result.product_name || '').replace(/"/g, '""')}"`,
        result.current_price,
        result.currency,
        result.availability,
        result.selected_size || '',
        result.source_url,
        result.meets_criteria,
        result.screenshot_path || '',
    ]);

    // Check if file exists to determine if we need headers
    const fileExists = fs.existsSync(filepath);

    let content = '';
    if (!fileExists) {
        content = headers.join(',') + '\n';
    }

    content += rows.map(row => row.join(',')).join('\n') + '\n';

    fs.appendFileSync(filepath, content, 'utf-8');
}

/**
 * Write task results to JSONL file
 */
async function writeJSONL(task, filepath) {
    const records = task.results.map(result => ({
        task_id: task.id,
        original_query: task.originalQuery,
        status: task.status,
        parsed: task.parsedTask ? {
            brand: task.parsedTask.product.brand,
            model: task.parsedTask.product.model,
            max_price: task.parsedTask.constraints.max_price,
            currency: task.parsedTask.constraints.currency,
        } : null,
        result: {
            product_name: result.product_name,
            current_price: result.current_price,
            currency: result.currency,
            availability: result.availability,
            size: result.selected_size,
            source_url: result.source_url,
            meets_criteria: result.meets_criteria,
            screenshot_path: result.screenshot_path,
        },
        timestamp: result.timestamp,
        execution_time_ms: task.executionTimeMs,
    }));

    const lines = records.map(r => JSON.stringify(r)).join('\n') + '\n';
    fs.appendFileSync(filepath, lines, 'utf-8');
}

/**
 * Write structured JSON summary
 */
async function writeSummary(task, filepath) {
    const summary = {
        task_id: task.id,
        status: task.status,
        original_query: task.originalQuery,
        parsed_task: task.parsedTask,
        results_count: task.results.length,
        matching_results: task.results.filter(r => r.meets_criteria).length,
        results: task.results,
        errors: task.errors,
        execution_time_ms: task.executionTimeMs,
        created_at: task.createdAt,
        completed_at: task.completedAt,
    };

    fs.writeFileSync(filepath, JSON.stringify(summary, null, 2), 'utf-8');
}

/**
 * Main function to write all result formats
 */
export async function writeResults(task) {
    const logger = createTaskLogger(task.id, 'ResultsWriter');

    try {
        // Generate date-based filename prefix
        const date = new Date().toISOString().split('T')[0];

        // Write to CSV
        const csvPath = path.join(config.resultsDir, `results_${date}.csv`);
        await writeCSV(task, csvPath);
        logger.debug('CSV results written', { path: csvPath });

        // Write to JSONL
        const jsonlPath = path.join(config.resultsDir, `results_${date}.jsonl`);
        await writeJSONL(task, jsonlPath);
        logger.debug('JSONL results written', { path: jsonlPath });

        // Write individual task summary
        const summaryPath = path.join(config.resultsDir, `task_${task.id}.json`);
        await writeSummary(task, summaryPath);
        logger.debug('Summary written', { path: summaryPath });

        logger.info('Results written successfully', {
            csv: csvPath,
            jsonl: jsonlPath,
            summary: summaryPath,
        });

        return {
            csv: csvPath,
            jsonl: jsonlPath,
            summary: summaryPath,
        };

    } catch (error) {
        logger.error('Failed to write results', { error: error.message });
        throw error;
    }
}

/**
 * Read results for a specific date
 */
export async function readResults(date) {
    const jsonlPath = path.join(config.resultsDir, `results_${date}.jsonl`);

    if (!fs.existsSync(jsonlPath)) {
        return [];
    }

    const content = fs.readFileSync(jsonlPath, 'utf-8');
    return content.split('\n')
        .filter(line => line.trim())
        .map(line => JSON.parse(line));
}

/**
 * Get list of available result files
 */
export function listResultFiles() {
    const files = fs.readdirSync(config.resultsDir);

    return files
        .filter(f => f.endsWith('.jsonl') || f.endsWith('.csv'))
        .map(f => ({
            filename: f,
            path: path.join(config.resultsDir, f),
            type: f.endsWith('.jsonl') ? 'jsonl' : 'csv',
        }));
}

export default { writeResults, readResults, listResultFiles };
