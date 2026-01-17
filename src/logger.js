import winston from 'winston';
import path from 'path';
import config from './config.js';

const { combine, timestamp, printf, colorize, json } = winston.format;

/**
 * Custom format for console output
 */
const consoleFormat = printf(({ level, message, timestamp, taskId, component, ...rest }) => {
    const taskStr = taskId ? `[${taskId.slice(0, 8)}]` : '';
    const compStr = component ? `[${component}]` : '';
    const extra = Object.keys(rest).length > 0 ? ` ${JSON.stringify(rest)}` : '';
    return `${timestamp} ${level} ${taskStr}${compStr} ${message}${extra}`;
});

/**
 * Create Winston logger instance
 */
const logger = winston.createLogger({
    level: config.logLevel,
    format: combine(
        timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
        json()
    ),
    defaultMeta: { service: 'price-monitor' },
    transports: [
        // File transport for all logs
        new winston.transports.File({
            filename: path.join(config.logsDir, 'error.log'),
            level: 'error',
        }),
        new winston.transports.File({
            filename: path.join(config.logsDir, 'combined.log'),
        }),
    ],
});

// Console transport for development
if (process.env.NODE_ENV !== 'production') {
    logger.add(
        new winston.transports.Console({
            format: combine(
                colorize(),
                timestamp({ format: 'HH:mm:ss' }),
                consoleFormat
            ),
        })
    );
}

/**
 * Create a child logger with task context
 */
export function createTaskLogger(taskId, component) {
    return logger.child({ taskId, component });
}

/**
 * Log structured task event
 */
export function logTaskEvent(taskId, event, data = {}) {
    logger.info({
        taskId,
        event,
        ...data,
        timestamp: new Date().toISOString(),
    });
}

/**
 * Log task result
 */
export function logTaskResult(taskId, status, result = {}) {
    const level = status === 'OK' ? 'info' : 'warn';
    logger[level]({
        taskId,
        event: 'task_completed',
        status,
        ...result,
        timestamp: new Date().toISOString(),
    });
}

export default logger;
