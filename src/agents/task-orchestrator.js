import { v4 as uuidv4 } from 'uuid';
import config from '../config.js';
import logger, { createTaskLogger, logTaskEvent, logTaskResult } from '../logger.js';
import { TaskStatus } from '../schemas.js';
import { createIntentParser } from './intent-parser.js';
import { createBrowserAgent } from './browser-agent.js';
import { createComputerUseAgent } from './computer-use-agent.js';
import { validateTask, needsClarification, formatValidationErrors } from '../validation/guardrails.js';
import { writeResults } from '../output/results-writer.js';

/**
 * Task Orchestrator - coordinates the complete monitoring workflow
 */
export class TaskOrchestrator {
    constructor() {
        this.intentParser = createIntentParser();
        this.activeTasks = new Map();
    }

    /**
     * Create a new monitoring task from user input
     */
    async createTask(userInput) {
        const taskId = uuidv4();
        const taskLogger = createTaskLogger(taskId, 'TaskOrchestrator');

        const task = {
            id: taskId,
            status: TaskStatus.PENDING,
            originalQuery: userInput,
            parsedTask: null,
            results: [],
            errors: [],
            createdAt: new Date().toISOString(),
            completedAt: null,
            executionTimeMs: 0,
        };

        this.activeTasks.set(taskId, task);

        logTaskEvent(taskId, 'task_created', { query: userInput });
        taskLogger.info('Task created', { query: userInput.substring(0, 100) });

        return task;
    }

    /**
     * Process a user query through the complete pipeline
     */
    async processQuery(userInput) {
        const startTime = Date.now();

        // Create task
        const task = await this.createTask(userInput);
        const taskLogger = createTaskLogger(task.id, 'TaskOrchestrator');

        try {
            // Phase 1: Intent Parsing
            task.status = TaskStatus.IN_PROGRESS;
            logTaskEvent(task.id, 'parsing_started');

            const parseResult = await this.intentParser.parse(userInput, task.id);

            if (!parseResult.success) {
                task.status = TaskStatus.VALIDATION_FAILED;
                task.errors.push(`Intent parsing failed: ${parseResult.error}`);
                return this.finalizeTask(task, startTime);
            }

            task.parsedTask = parseResult.parsedTask;
            logTaskEvent(task.id, 'parsing_completed', {
                confidence: task.parsedTask.confidence,
                brand: task.parsedTask.product.brand,
            });

            // Phase 2: Check for clarification
            const clarification = needsClarification(task.parsedTask);
            if (clarification.needsClarification) {
                task.status = TaskStatus.CLARIFICATION_NEEDED;
                task.errors = clarification.questions;
                return this.finalizeTask(task, startTime);
            }

            // Phase 3: Validation
            logTaskEvent(task.id, 'validation_started');
            const validation = validateTask(task.parsedTask);

            if (!validation.valid) {
                task.status = TaskStatus.VALIDATION_FAILED;
                task.errors = validation.errors;
                taskLogger.warn('Validation failed', { errors: validation.errors });
                return this.finalizeTask(task, startTime);
            }

            if (validation.warnings.length > 0) {
                taskLogger.info('Validation warnings', { warnings: validation.warnings });
            }

            logTaskEvent(task.id, 'validation_completed');

            // Phase 4: Execution (browser/computer use)
            if (config.dryRun) {
                taskLogger.info('Dry-run mode - using mock execution');
            }

            logTaskEvent(task.id, 'execution_started');

            let executionResult;

            // Choose execution method: Computer Use or traditional Browser Agent
            if (config.useComputerUse) {
                taskLogger.info('Using Computer Use agent for visual browser control');
                const computerUseAgent = createComputerUseAgent();

                // Build goal from parsed task
                const goal = this.buildComputerUseGoal(task.parsedTask);
                const cuResult = await computerUseAgent.executeTask(goal, task.id);

                // Map Computer Use results to standard format
                executionResult = {
                    status: cuResult.success ? TaskStatus.OK : TaskStatus.TIMEOUT,
                    results: cuResult.results.map(r => ({
                        product_name: r.product_name || 'Unknown',
                        current_price: r.price || 0,
                        currency: r.currency || 'EUR',
                        store_name: r.store_name || 'Unknown Store',
                        availability: r.availability || 'unknown',
                        source_url: r.source_url || '',
                        screenshot_path: r.screenshot_path || null,
                        meets_criteria: task.parsedTask.constraints.max_price
                            ? r.price <= task.parsedTask.constraints.max_price
                            : true,
                    })),
                    errors: cuResult.success ? [] : [cuResult.error || 'Computer Use execution failed'],
                };
            } else {
                taskLogger.info('Using traditional Browser Agent');
                const browserAgent = createBrowserAgent();
                executionResult = await browserAgent.executeTask(task.parsedTask, task.id);
            }

            task.status = executionResult.status;
            task.results = executionResult.results;
            task.errors.push(...executionResult.errors);

            logTaskEvent(task.id, 'execution_completed', {
                status: executionResult.status,
                resultCount: executionResult.results.length,
            });

            // Phase 5: Write results
            if (task.results.length > 0) {
                await writeResults(task);
                logTaskEvent(task.id, 'results_written');
            }

            return this.finalizeTask(task, startTime);

        } catch (error) {
            taskLogger.error('Task failed with exception', { error: error.message });
            task.status = TaskStatus.TIMEOUT;
            task.errors.push(error.message);
            return this.finalizeTask(task, startTime);
        }
    }

    /**
     * Finalize task and record completion
     */
    finalizeTask(task, startTime) {
        task.completedAt = new Date().toISOString();
        task.executionTimeMs = Date.now() - startTime;

        logTaskResult(task.id, task.status, {
            resultCount: task.results.length,
            errorCount: task.errors.length,
            executionTimeMs: task.executionTimeMs,
        });

        // Remove from active tasks
        this.activeTasks.delete(task.id);

        return this.formatTaskResponse(task);
    }

    /**
     * Format task for API response
     */
    formatTaskResponse(task) {
        const response = {
            task_id: task.id,
            status: task.status,
            original_query: task.originalQuery,
        };

        // Include parsed task info if available
        if (task.parsedTask) {
            response.parsed = {
                product: task.parsedTask.product,
                constraints: task.parsedTask.constraints,
                sources: task.parsedTask.sources,
                confidence: task.parsedTask.confidence,
            };
        }

        // Include results if successful
        if (task.status === TaskStatus.OK && task.results.length > 0) {
            response.results = task.results.map(r => ({
                product_name: r.product_name,
                current_price: r.current_price,
                currency: r.currency,
                store_name: r.store_name,
                availability: r.availability,
                source_url: r.source_url,
                meets_criteria: r.meets_criteria,
                screenshot: r.screenshot_path,
            }));

            // Summary
            const matchingResults = task.results.filter(r => r.meets_criteria);
            response.summary = {
                total_results: task.results.length,
                matching_criteria: matchingResults.length,
                lowest_price: task.results.reduce((min, r) =>
                    r.current_price < min ? r.current_price : min, Infinity),
            };
        }

        // Include errors/clarification questions
        if (task.errors.length > 0) {
            if (task.status === TaskStatus.CLARIFICATION_NEEDED) {
                response.clarification_needed = task.errors;
            } else {
                response.errors = task.errors;
            }
        }

        response.execution_time_ms = task.executionTimeMs;
        response.timestamp = task.completedAt;

        return response;
    }

    /**
     * Get task status
     */
    getTaskStatus(taskId) {
        const task = this.activeTasks.get(taskId);
        if (!task) {
            return null;
        }
        return {
            task_id: task.id,
            status: task.status,
            created_at: task.createdAt,
        };
    }

    /**
     * Get all active tasks
     */
    getActiveTasks() {
        return Array.from(this.activeTasks.values()).map(task => ({
            task_id: task.id,
            status: task.status,
            query: task.originalQuery.substring(0, 50),
            created_at: task.createdAt,
        }));
    }

    /**
     * Build a natural language goal for Computer Use agent
     */
    buildComputerUseGoal(parsedTask) {
        const parts = [];

        // Start with navigation instruction based on source mode
        if (parsedTask.sources?.mode === 'direct_url' && parsedTask.sources?.url) {
            parts.push(`Go to ${parsedTask.sources.url} and search on that website for`);
        } else if (parsedTask.sources?.mode === 'google') {
            parts.push('Go to Google.com and search for');
        } else if (parsedTask.sources?.sites?.length > 0) {
            parts.push(`Go to ${parsedTask.sources.sites[0]}.com and search for`);
        } else {
            parts.push('Search on Google for');
        }

        // Product info
        if (parsedTask.product.brand) {
            parts.push(parsedTask.product.brand);
        }
        if (parsedTask.product.model) {
            parts.push(parsedTask.product.model);
        }
        if (parsedTask.product.color) {
            parts.push(parsedTask.product.color);
        }
        if (parsedTask.product.category) {
            parts.push(parsedTask.product.category);
        }

        // Price constraint
        if (parsedTask.constraints?.max_price) {
            parts.push(`under ${parsedTask.constraints.max_price}${parsedTask.constraints.currency || '€'}`);
        }

        // Final instruction
        const goal = parts.join(' ') +
            '. Find the product price and extract it. ' +
            'Navigate to a product page if needed, scroll to see the price, and report the price you find.';

        return goal;
    }
}

// Singleton instance
let orchestratorInstance = null;

export function getOrchestrator() {
    if (!orchestratorInstance) {
        orchestratorInstance = new TaskOrchestrator();
    }
    return orchestratorInstance;
}

export default { TaskOrchestrator, getOrchestrator };
