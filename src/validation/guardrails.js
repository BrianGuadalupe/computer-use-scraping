import config from '../config.js';
import { TaskStatus } from '../schemas.js';

/**
 * Validation result structure
 */
function createValidationResult(valid, errors = [], warnings = []) {
    return {
        valid,
        errors,
        warnings,
        status: valid ? null : TaskStatus.VALIDATION_FAILED,
    };
}

/**
 * Validate that we have enough product information
 */
function validateProduct(product) {
    const errors = [];
    const warnings = [];

    // Must have at least brand OR model
    if (!product.brand && !product.model) {
        errors.push('Either brand or model must be specified to search for a product');
    }

    // Warn if very generic
    if (!product.brand && !product.model && !product.category) {
        warnings.push('Search may be very broad. Consider specifying brand, model, or category.');
    }

    return { errors, warnings };
}

/**
 * Validate price constraints
 */
function validateConstraints(constraints) {
    const errors = [];
    const warnings = [];

    if (constraints.max_price !== null) {
        if (typeof constraints.max_price !== 'number' || constraints.max_price <= 0) {
            errors.push('max_price must be a positive number');
        }

        if (constraints.max_price > 100000) {
            warnings.push('Very high price threshold detected. Please confirm this is intentional.');
        }
    }

    return { errors, warnings };
}

/**
 * Validate sources configuration
 */
function validateSources(sources) {
    const errors = [];
    const warnings = [];

    if (!sources.mode) {
        errors.push('Search mode must be specified (google or specific_sites)');
    }

    if (sources.mode === 'specific_sites') {
        if (!sources.sites || sources.sites.length === 0) {
            errors.push('At least one site must be specified when using specific_sites mode');
        }

        // Check if sites are known
        const knownSites = Object.keys(config.sites.sites || {});
        const unknownSites = (sources.sites || []).filter(site =>
            !knownSites.includes(site.toLowerCase())
        );

        if (unknownSites.length > 0) {
            warnings.push(`Unknown sites will use generic extraction: ${unknownSites.join(', ')}`);
        }
    }

    return { errors, warnings };
}

/**
 * Validate confidence threshold
 */
function validateConfidence(confidence) {
    const errors = [];
    const warnings = [];

    if (typeof confidence !== 'number' || confidence < 0 || confidence > 1) {
        errors.push('Confidence must be a number between 0 and 1');
    } else if (confidence < config.minConfidence) {
        errors.push(`Confidence score (${confidence.toFixed(2)}) is below minimum threshold (${config.minConfidence}). Please provide more details.`);
    } else if (confidence < 0.7) {
        warnings.push('Moderate confidence in parsing. Results may not be exactly what you intended.');
    }

    return { errors, warnings };
}

/**
 * Main guardrail validation function
 * Validates a parsed task before execution
 */
export function validateTask(parsedTask) {
    const allErrors = [];
    const allWarnings = [];

    // Validate task type
    if (parsedTask.task_type !== 'price_monitoring') {
        allErrors.push(`Unsupported task type: ${parsedTask.task_type}`);
    }

    // Validate product
    const productValidation = validateProduct(parsedTask.product);
    allErrors.push(...productValidation.errors);
    allWarnings.push(...productValidation.warnings);

    // Validate constraints
    const constraintsValidation = validateConstraints(parsedTask.constraints);
    allErrors.push(...constraintsValidation.errors);
    allWarnings.push(...constraintsValidation.warnings);

    // Validate sources
    const sourcesValidation = validateSources(parsedTask.sources);
    allErrors.push(...sourcesValidation.errors);
    allWarnings.push(...sourcesValidation.warnings);

    // Validate confidence
    const confidenceValidation = validateConfidence(parsedTask.confidence);
    allErrors.push(...confidenceValidation.errors);
    allWarnings.push(...confidenceValidation.warnings);

    return createValidationResult(
        allErrors.length === 0,
        allErrors,
        allWarnings
    );
}

/**
 * Check if clarification is needed based on parsed task
 */
export function needsClarification(parsedTask) {
    const questions = [];

    // Check for low confidence
    if (parsedTask.confidence < config.minConfidence) {
        questions.push('Could you provide more details about the product you\'re looking for?');
    }

    // Check for missing critical info
    if (!parsedTask.product.brand && !parsedTask.product.model) {
        questions.push('What brand or specific product model are you looking for?');
    }

    if (parsedTask.sources.mode === 'specific_sites' && (!parsedTask.sources.sites || parsedTask.sources.sites.length === 0)) {
        questions.push('Which websites should I check for prices?');
    }

    return {
        needsClarification: questions.length > 0,
        questions,
    };
}

/**
 * Generate human-readable validation error message
 */
export function formatValidationErrors(validationResult) {
    if (validationResult.valid) {
        return null;
    }

    let message = 'I couldn\'t process your request because:\n\n';

    validationResult.errors.forEach((error, index) => {
        message += `${index + 1}. ${error}\n`;
    });

    if (validationResult.warnings.length > 0) {
        message += '\nAdditional notes:\n';
        validationResult.warnings.forEach(warning => {
            message += `• ${warning}\n`;
        });
    }

    return message;
}

export default {
    validateTask,
    needsClarification,
    formatValidationErrors,
};
