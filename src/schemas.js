import { z } from 'zod';

/**
 * Product schema for parsed intent
 */
export const ProductSchema = z.object({
    brand: z.string().nullable(),
    model: z.string().nullable(),
    category: z.string().nullable(),
    color: z.string().nullable(),
    gender: z.string().nullable(),
});

/**
 * Constraints schema
 */
export const ConstraintsSchema = z.object({
    max_price: z.number().positive().nullable(),
    currency: z.string().nullable(),
    size: z.string().nullable(),
});

/**
 * Sources schema
 */
export const SourcesSchema = z.object({
    mode: z.enum(['google', 'specific_sites']),
    sites: z.array(z.string()).nullable(),
});

/**
 * Parsed task schema - the execution contract
 */
export const ParsedTaskSchema = z.object({
    task_type: z.literal('price_monitoring'),
    product: ProductSchema,
    constraints: ConstraintsSchema,
    sources: SourcesSchema,
    search_strategy: z.enum(['google', 'site_internal']).nullable(),
    confidence: z.number().min(0).max(1),
});

/**
 * Task status enumeration
 */
export const TaskStatus = {
    OK: 'OK',
    NOT_FOUND: 'NOT_FOUND',
    CAPTCHA: 'CAPTCHA',
    BLOCKED: 'BLOCKED',
    VALIDATION_FAILED: 'VALIDATION_FAILED',
    LAYOUT_CHANGED: 'LAYOUT_CHANGED',
    TIMEOUT: 'TIMEOUT',
    PENDING: 'PENDING',
    IN_PROGRESS: 'IN_PROGRESS',
    CLARIFICATION_NEEDED: 'CLARIFICATION_NEEDED',
};

/**
 * Extraction result schema
 */
export const ExtractionResultSchema = z.object({
    product_name: z.string(),
    current_price: z.number().positive(),
    currency: z.string(),
    availability: z.enum(['in_stock', 'out_of_stock', 'unknown']),
    selected_size: z.string().nullable(),
    timestamp: z.string().datetime(),
    source_url: z.string().url(),
    screenshot_path: z.string().nullable(),
    meets_criteria: z.boolean(),
});

/**
 * Task result schema
 */
export const TaskResultSchema = z.object({
    task_id: z.string().uuid(),
    status: z.nativeEnum(TaskStatus),
    original_query: z.string(),
    parsed_task: ParsedTaskSchema.nullable(),
    results: z.array(ExtractionResultSchema),
    errors: z.array(z.string()),
    execution_time_ms: z.number(),
    created_at: z.string().datetime(),
    completed_at: z.string().datetime().nullable(),
});

/**
 * Clarification request schema
 */
export const ClarificationRequestSchema = z.object({
    needs_clarification: z.literal(true),
    questions: z.array(z.string()),
    partial_parse: ParsedTaskSchema.partial().nullable(),
});

/**
 * Intent parser response - either parsed task or clarification request
 */
export const IntentParserResponseSchema = z.union([
    ParsedTaskSchema,
    ClarificationRequestSchema,
]);

/**
 * API request schema
 */
export const MonitorRequestSchema = z.object({
    query: z.string().min(1).max(1000),
    dry_run: z.boolean().optional(),
});

/**
 * Validate against schema with detailed errors
 */
export function validateSchema(schema, data) {
    const result = schema.safeParse(data);
    if (result.success) {
        return { valid: true, data: result.data, errors: [] };
    }

    const errors = result.error.errors.map(err =>
        `${err.path.join('.')}: ${err.message}`
    );
    return { valid: false, data: null, errors };
}

export default {
    ProductSchema,
    ConstraintsSchema,
    SourcesSchema,
    ParsedTaskSchema,
    TaskStatus,
    ExtractionResultSchema,
    TaskResultSchema,
    ClarificationRequestSchema,
    IntentParserResponseSchema,
    MonitorRequestSchema,
    validateSchema,
};
