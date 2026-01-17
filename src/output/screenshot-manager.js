import fs from 'fs';
import path from 'path';
import config from '../config.js';
import { createTaskLogger } from '../logger.js';

/**
 * Screenshot Manager - handles screenshot organization and storage
 */
export class ScreenshotManager {
    constructor() {
        this.logger = createTaskLogger('screenshot-manager', 'ScreenshotManager');
    }

    /**
     * Generate screenshot filename
     */
    generateFilename(taskId, label, extension = 'png') {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const sanitizedLabel = label.replace(/[^a-zA-Z0-9_-]/g, '_').toLowerCase();
        return `${taskId}_${sanitizedLabel}_${timestamp}.${extension}`;
    }

    /**
     * Get screenshot path for a task
     */
    getScreenshotPath(taskId, label) {
        const filename = this.generateFilename(taskId, label);
        return path.join(config.screenshotsDir, filename);
    }

    /**
     * Save screenshot data
     */
    async saveScreenshot(taskId, label, buffer) {
        const filepath = this.getScreenshotPath(taskId, label);

        try {
            fs.writeFileSync(filepath, buffer);
            this.logger.debug('Screenshot saved', { taskId, filepath });
            return filepath;
        } catch (error) {
            this.logger.error('Failed to save screenshot', {
                taskId,
                error: error.message
            });
            throw error;
        }
    }

    /**
     * Get all screenshots for a task
     */
    getTaskScreenshots(taskId) {
        const files = fs.readdirSync(config.screenshotsDir);
        return files
            .filter(f => f.startsWith(taskId))
            .map(f => ({
                filename: f,
                path: path.join(config.screenshotsDir, f),
                url: `/screenshots/${f}`,
            }));
    }

    /**
     * Delete old screenshots (cleanup)
     */
    async cleanup(maxAgeDays = 7) {
        const maxAgeMs = maxAgeDays * 24 * 60 * 60 * 1000;
        const now = Date.now();
        let deleted = 0;

        try {
            const files = fs.readdirSync(config.screenshotsDir);

            for (const file of files) {
                const filepath = path.join(config.screenshotsDir, file);
                const stats = fs.statSync(filepath);

                if (now - stats.mtimeMs > maxAgeMs) {
                    fs.unlinkSync(filepath);
                    deleted++;
                }
            }

            this.logger.info('Cleanup completed', { deleted });
            return deleted;

        } catch (error) {
            this.logger.error('Cleanup failed', { error: error.message });
            throw error;
        }
    }

    /**
     * Get screenshot statistics
     */
    getStats() {
        const files = fs.readdirSync(config.screenshotsDir);
        let totalSize = 0;

        for (const file of files) {
            const filepath = path.join(config.screenshotsDir, file);
            const stats = fs.statSync(filepath);
            totalSize += stats.size;
        }

        return {
            count: files.length,
            totalSizeBytes: totalSize,
            totalSizeMB: (totalSize / (1024 * 1024)).toFixed(2),
        };
    }
}

// Singleton instance
let managerInstance = null;

export function getScreenshotManager() {
    if (!managerInstance) {
        managerInstance = new ScreenshotManager();
    }
    return managerInstance;
}

export default { ScreenshotManager, getScreenshotManager };
