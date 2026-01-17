/**
 * Price Monitor - Frontend Application
 */

// DOM Elements
const queryInput = document.getElementById('query-input');
const submitBtn = document.getElementById('submit-btn');
const modeIndicator = document.getElementById('mode-badge');
const statusSection = document.getElementById('status-section');
const statusTitle = document.getElementById('status-title');
const statusMessage = document.getElementById('status-message');
const progressFill = document.getElementById('progress-fill');
const resultsSection = document.getElementById('results-section');
const resultsSummary = document.getElementById('results-summary');
const resultsGrid = document.getElementById('results-grid');
const errorSection = document.getElementById('error-section');
const errorTitle = document.getElementById('error-title');
const errorMessage = document.getElementById('error-message');
const retryBtn = document.getElementById('retry-btn');
const clarificationSection = document.getElementById('clarification-section');
const clarificationQuestions = document.getElementById('clarification-list');
const parsedSection = document.getElementById('parsed-section');
const parsedContent = document.getElementById('parsed-content');
const exampleBtns = document.querySelectorAll('.example-btn');

// State
let isProcessing = false;

/**
 * Initialize the application
 */
async function init() {
    // Load system info
    await loadSystemInfo();

    // Event listeners
    submitBtn.addEventListener('click', handleSubmit);
    queryInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSubmit();
        }
    });

    retryBtn.addEventListener('click', () => {
        hideAllSections();
        queryInput.focus();
    });

    exampleBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            queryInput.value = btn.dataset.query;
            queryInput.focus();
        });
    });
}

/**
 * Load system information
 */
async function loadSystemInfo() {
    try {
        const response = await fetch('/api/health');
        const data = await response.json();

        modeIndicator.textContent = data.mode === 'dry-run' ? 'Dry Run' : 'Live';
        modeIndicator.classList.remove('live', 'dry-run');
        modeIndicator.classList.add(data.mode === 'dry-run' ? 'dry-run' : 'live');
    } catch (error) {
        modeIndicator.textContent = 'Offline';
        console.error('Failed to load system info:', error);
    }
}

/**
 * Handle form submission
 */
async function handleSubmit() {
    const query = queryInput.value.trim();

    if (!query) {
        showError('Empty query', 'Please enter what you\'d like to track.');
        return;
    }

    if (isProcessing) return;

    isProcessing = true;
    submitBtn.disabled = true;

    hideAllSections();
    showStatus('Processing your request...', 'Analyzing natural language input');

    // Timeout configuration for Computer Use agent
    // Calculation: 
    // - Intent parsing: ~4s (99th percentile)
    // - Browser init: ~5s
    // - 20 turns max × 13s per turn (API + action + page load) = 260s
    // - Safety margin: +30s
    // Total: 300 seconds (5 minutes) for 99% confidence
    const REQUEST_TIMEOUT_MS = 300000; // 5 minutes
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
        // Simulate progress stages
        await updateProgress(20, 'Parsing intent...', 'Understanding product and constraints');

        const response = await fetch('/api/monitor', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query }),
            signal: controller.signal,
        });

        clearTimeout(timeoutId);

        await updateProgress(60, 'Processing...', 'Checking prices');

        const data = await response.json();

        await updateProgress(100, 'Complete!', 'Results ready');
        await sleep(500);

        handleResponse(data);

    } catch (error) {
        clearTimeout(timeoutId);
        console.error('Request failed:', error);

        if (error.name === 'AbortError') {
            showError('Request Timeout',
                `The search took longer than expected (>${REQUEST_TIMEOUT_MS / 1000}s). ` +
                'The Computer Use agent may still be working. Check the browser window.');
        } else {
            showError('Connection Error', 'Failed to connect to the server. Please try again.');
        }
    } finally {
        isProcessing = false;
        submitBtn.disabled = false;
    }
}

/**
 * Handle API response
 */
function handleResponse(data) {
    hideAllSections();

    // Show parsed information if available
    if (data.parsed) {
        showParsedInfo(data.parsed);
    }

    // Handle different status codes
    switch (data.status) {
        case 'OK':
            showResults(data);
            break;

        case 'CLARIFICATION_NEEDED':
            showClarification(data.clarification_needed);
            break;

        case 'VALIDATION_FAILED':
            showError('Validation Failed', data.errors?.join('\n') || 'Could not process your request.');
            break;

        case 'NOT_FOUND':
            showError('No Results', 'Could not find matching products. Try adjusting your search terms.');
            break;

        case 'CAPTCHA':
            showError('CAPTCHA Detected', 'The target site is requesting human verification. Please try again later.');
            break;

        case 'BLOCKED':
            showError('Access Blocked', 'The target site has temporarily blocked access. Please try again later.');
            break;

        case 'TIMEOUT':
            showError('Request Timeout', 'The request took too long. Please try again.');
            break;

        default:
            if (data.errors?.length > 0) {
                showError('Error', data.errors.join('\n'));
            } else {
                showResults(data);
            }
    }
}

/**
 * Show status section
 */
function showStatus(title, message) {
    statusSection.classList.remove('hidden');
    statusTitle.textContent = title;
    statusMessage.textContent = message;
    progressFill.style.width = '10%';
}

/**
 * Update progress
 */
async function updateProgress(percent, title, message) {
    progressFill.style.width = `${percent}%`;
    statusTitle.textContent = title;
    statusMessage.textContent = message;
    await sleep(300);
}

/**
 * Show results
 */
function showResults(data) {
    resultsSection.classList.remove('hidden');

    // Summary
    if (data.summary) {
        const matching = data.summary.matching_criteria;
        const total = data.summary.total_results;
        const lowest = data.summary.lowest_price;
        resultsSummary.textContent = `${matching}/${total} match criteria • Lowest: ${formatPrice(lowest, data.results[0]?.currency)}`;
    } else {
        resultsSummary.textContent = `${data.results?.length || 0} results found`;
    }

    // Results grid
    resultsGrid.innerHTML = '';

    if (data.results && data.results.length > 0) {
        data.results.forEach(result => {
            resultsGrid.appendChild(createResultCard(result));
        });
    } else {
        resultsGrid.innerHTML = '<p class="no-results">No results found</p>';
    }
}

/**
 * Create result card element
 */
function createResultCard(result) {
    const card = document.createElement('div');
    card.className = `result-card ${result.meets_criteria ? 'meets-criteria' : ''}`;

    const availabilityClass = result.availability === 'in_stock' ? 'in-stock' :
        result.availability === 'out_of_stock' ? 'out-of-stock' : '';

    card.innerHTML = `
    <div class="result-header">
      <div class="result-product">
        <h3>${escapeHtml(result.product_name)}</h3>
        <p class="store-name">${escapeHtml(result.store_name || getDomain(result.source_url))}</p>
      </div>
      <div class="result-price">
        <div class="price-value">${formatPrice(result.current_price, result.currency)}</div>
        <div class="price-status">${result.meets_criteria ? '✓ Below target' : 'Above target'}</div>
      </div>
    </div>
    <div class="result-meta">
      <div class="meta-item">
        <span class="meta-label">Store</span>
        <span class="meta-value">${escapeHtml(result.store_name || 'Unknown')}</span>
      </div>
      <div class="meta-item">
        <span class="meta-label">Availability</span>
        <span class="meta-value ${availabilityClass}">${formatAvailability(result.availability)}</span>
      </div>
      ${result.screenshot ? `
      <div class="meta-item">
        <span class="meta-label">Evidence</span>
        <span class="meta-value">📸 Screenshot</span>
      </div>
      ` : ''}
      <a href="${escapeHtml(result.source_url)}" target="_blank" rel="noopener" class="result-link">
        View Product →
      </a>
    </div>
  `;

    return card;
}

/**
 * Show parsed information panel
 */
function showParsedInfo(parsed) {
    parsedSection.classList.remove('hidden');
    parsedContent.innerHTML = '';

    const items = [];

    if (parsed.product?.brand) {
        items.push({ label: 'Brand', value: parsed.product.brand });
    }
    if (parsed.product?.model) {
        items.push({ label: 'Model', value: parsed.product.model });
    }
    if (parsed.product?.category) {
        items.push({ label: 'Category', value: parsed.product.category });
    }
    if (parsed.product?.color) {
        items.push({ label: 'Color', value: parsed.product.color });
    }
    if (parsed.constraints?.max_price) {
        items.push({
            label: 'Max Price',
            value: formatPrice(parsed.constraints.max_price, parsed.constraints.currency)
        });
    }
    if (parsed.sources?.mode) {
        let searchValue;
        if (parsed.sources.url) {
            // Show the direct URL
            searchValue = parsed.sources.url;
        } else if (parsed.sources.sites?.length > 0) {
            searchValue = parsed.sources.sites.join(', ');
        } else {
            searchValue = 'Google Search';
        }
        items.push({ label: 'Search', value: searchValue });
    }
    if (parsed.confidence) {
        items.push({ label: 'Confidence', value: `${Math.round(parsed.confidence * 100)}%` });
    }

    items.forEach(item => {
        const el = document.createElement('div');
        el.className = 'parsed-item';
        el.innerHTML = `
      <span class="parsed-label">${item.label}:</span>
      <span class="parsed-value">${escapeHtml(item.value)}</span>
    `;
        parsedContent.appendChild(el);
    });
}

/**
 * Show clarification section
 */
function showClarification(questions) {
    clarificationSection.classList.remove('hidden');
    clarificationQuestions.innerHTML = '';

    questions.forEach(q => {
        const li = document.createElement('li');
        li.textContent = q;
        clarificationQuestions.appendChild(li);
    });
}

/**
 * Show error section
 */
function showError(title, message) {
    errorSection.classList.remove('hidden');
    errorTitle.textContent = title;
    errorMessage.textContent = message;
}

/**
 * Hide all result sections
 */
function hideAllSections() {
    statusSection.classList.add('hidden');
    resultsSection.classList.add('hidden');
    errorSection.classList.add('hidden');
    clarificationSection.classList.add('hidden');
    parsedSection.classList.add('hidden');
}

// Utility functions

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function formatPrice(amount, currency = 'EUR') {
    if (amount === null || amount === undefined) return 'N/A';

    const symbols = { EUR: '€', USD: '$', GBP: '£' };
    const symbol = symbols[currency] || currency;

    return `${symbol}${amount.toFixed(2)}`;
}

function formatAvailability(status) {
    const labels = {
        'in_stock': 'In Stock',
        'out_of_stock': 'Out of Stock',
        'unknown': 'Unknown',
    };
    return labels[status] || status;
}

function getDomain(url) {
    try {
        return new URL(url).hostname.replace('www.', '');
    } catch {
        return 'Unknown';
    }
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Initialize on load
document.addEventListener('DOMContentLoaded', init);
