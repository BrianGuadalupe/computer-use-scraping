# Price Monitor

A production-grade price monitoring platform that allows non-technical users to track apparel prices using natural language.

![Price Monitor Interface](./docs/screenshot.png)

## Features

- **Natural Language Interface** - Simply describe what you're looking for
- **LLM-Powered Intent Parsing** - Converts human requests into structured tasks
- **Browser Automation** - Uses Playwright for real browser scraping
- **Human-Like Behavior** - Random delays, scrolling, cookie handling
- **Screenshot Evidence** - Captures proof of every price check
- **Multiple Output Formats** - CSV, JSONL, and JSON results
- **Extensible Site Adapters** - Easy to add new shopping sites
- **Guardrails & Validation** - Prevents invalid or risky operations

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                        Web Interface                         │
│                  (Natural Language Input)                    │
└──────────────────────────┬───────────────────────────────────┘
                           │
                           ▼
┌──────────────────────────────────────────────────────────────┐
│                    Intent Parser Agent                       │
│            (LLM: Google Gemini / Mock for dry-run)           │
│                                                              │
│   "Find Nike Air Force 1 under 110€ on Zalando"             │
│                           ↓                                  │
│   {                                                          │
│     "product": { "brand": "Nike", "model": "Air Force 1" }, │
│     "constraints": { "max_price": 110, "currency": "EUR" }, │
│     "sources": { "mode": "specific_sites", "sites": [...] } │
│   }                                                          │
└──────────────────────────┬───────────────────────────────────┘
                           │
                           ▼
┌──────────────────────────────────────────────────────────────┐
│                 Guardrails & Validation                      │
│                                                              │
│   ✓ Brand or model present                                  │
│   ✓ Sources defined                                         │
│   ✓ Confidence threshold met (>0.6)                         │
│   ✓ Price constraints valid                                 │
└──────────────────────────┬───────────────────────────────────┘
                           │
                           ▼
┌──────────────────────────────────────────────────────────────┐
│                    Browser Agent                             │
│                   (Playwright/Chrome)                        │
│                                                              │
│   • Human-like delays                                       │
│   • Cookie banner handling                                  │
│   • CAPTCHA detection                                       │
│   • Multi-strategy price extraction                         │
│   • Screenshot capture                                      │
└──────────────────────────┬───────────────────────────────────┘
                           │
                           ▼
┌──────────────────────────────────────────────────────────────┐
│                     Output Layer                             │
│                                                              │
│   📄 CSV Results        → outputs/results/results_YYYY-MM-DD.csv
│   📋 JSONL Results      → outputs/results/results_YYYY-MM-DD.jsonl
│   📸 Screenshots        → outputs/screenshots/
│   📝 Logs               → logs/combined.log
└──────────────────────────────────────────────────────────────┘
```

## Quick Start

### Prerequisites

- Node.js 18 or higher
- npm or yarn

### Installation

```bash
# Clone the repository
cd galactic-meteor

# Install dependencies
npm install

# Install Playwright browsers
npx playwright install chromium

# Copy environment template
cp .env.example .env
```

### Configuration

Edit `.env` with your settings:

```env
# Required for live mode - Google Gemini API
GEMINI_API_KEY=your-gemini-api-key-here
GEMINI_MODEL=gemini-2.0-flash

# Optional
PORT=3000
DRY_RUN=false
DEBUG_MODE=false
HEADLESS=true
```

### Running

```bash
# Start in live mode
npm start

# Start in dry-run mode (no real scraping, mock data)
npm run dev:dry

# Start in debug mode (visible browser, extended delays)
npm run dev:debug
```

Open http://localhost:3000 in your browser.

## Usage

### Example Queries

```
"Let me know if Adidas Samba black drop below 90€ on Zalando or Farfetch"

"Check if Nike Air Force 1 white are under 110€ by searching on Google"

"Find Patagonia Down Sweater jacket men size M under 250€ online"

"Track New Balance 550 price on ASOS"
```

### API Endpoint

```bash
curl -X POST http://localhost:3000/api/monitor \
  -H "Content-Type: application/json" \
  -d '{"query": "Find Nike Air Force 1 under 100€ on Google"}'
```

Response:
```json
{
  "task_id": "550e8400-e29b-41d4-a716-446655440000",
  "status": "OK",
  "parsed": {
    "product": {
      "brand": "Nike",
      "model": "Air Force 1"
    },
    "constraints": {
      "max_price": 100,
      "currency": "EUR"
    }
  },
  "results": [
    {
      "product_name": "Nike Air Force 1 '07",
      "current_price": 89.99,
      "currency": "EUR",
      "availability": "in_stock",
      "meets_criteria": true,
      "source_url": "https://..."
    }
  ],
  "summary": {
    "total_results": 5,
    "matching_criteria": 3,
    "lowest_price": 89.99
  }
}
```

## Adding New Sites

### 1. Add Site Configuration

Edit `configs/sites.yaml`:

```yaml
sites:
  newsite:
    name: "New Site"
    type: "retailer"
    domains:
      - "newsite.com"
    search_url: "https://www.newsite.com/search?q={query}"
    selectors:
      search_input: "input[name='search']"
      result_container: ".product-card"
      price: ".price"
      product_name: ".product-title"
      product_link: "a.product-link"
      cookie_accept: "#cookie-accept"
    rate_limit: 5000
    requires_javascript: true
```

### 2. Create Custom Adapter (Optional)

For sites requiring special handling, create `src/adapters/newsite-adapter.js`:

```javascript
import { BaseAdapter } from './base-adapter.js';

export class NewSiteAdapter extends BaseAdapter {
  async search(query, page) {
    // Custom search logic
  }

  async extractPrice(page) {
    // Custom price extraction
  }
}
```

### 3. Register the Adapter

The system will automatically use the generic adapter for any site defined in `sites.yaml`. Custom adapters are only needed for complex cases.

## Task Status Codes

| Status | Description |
|--------|-------------|
| `OK` | Successfully extracted price information |
| `NOT_FOUND` | Product not found on the target site |
| `CAPTCHA` | CAPTCHA detected, scraping stopped |
| `BLOCKED` | Access denied by the site (403/429) |
| `VALIDATION_FAILED` | Input failed guardrail checks |
| `LAYOUT_CHANGED` | Site structure changed, selectors don't match |
| `TIMEOUT` | Request exceeded time limit |
| `CLARIFICATION_NEEDED` | Need more information from user |

## Failure Modes & Troubleshooting

### "CAPTCHA" Status
The target site is requesting human verification. Wait and try again later, or switch to a different site.

### "BLOCKED" Status
The site has rate-limited or blocked the request. Increase `rate_limit` in site config, or wait before retrying.

### "LAYOUT_CHANGED" Status
The site's HTML structure has changed. Update the selectors in `configs/sites.yaml`.

### "VALIDATION_FAILED" Status
The query didn't contain enough information. Check the error message for details on what's missing.

### Low Confidence Parsing
If the system frequently asks for clarification, try being more specific:
- Include the brand name
- Specify exact product model
- Mention currency with the price (e.g., "90€" instead of just "90")
- Name specific sites instead of "online"

## Project Structure

```
galactic-meteor/
├── package.json            # Project configuration
├── .env.example            # Environment template
├── README.md               # This file
│
├── src/
│   ├── index.js            # Express server entry point
│   ├── config.js           # Configuration loader
│   ├── schemas.js          # Zod validation schemas
│   ├── logger.js           # Winston logging setup
│   │
│   ├── agents/
│   │   ├── intent-parser.js      # LLM intent parsing
│   │   ├── browser-agent.js      # Playwright automation
│   │   └── task-orchestrator.js  # Workflow coordination
│   │
│   ├── validation/
│   │   ├── guardrails.js   # Pre-execution validation
│   │   └── normalizers.js  # Data normalization
│   │
│   ├── adapters/           # Site-specific adapters
│   │   └── ...
│   │
│   └── output/
│       ├── results-writer.js     # CSV/JSONL output
│       └── screenshot-manager.js # Screenshot handling
│
├── public/                 # Web interface
│   ├── index.html
│   ├── styles.css
│   └── app.js
│
├── configs/
│   ├── sites.yaml          # Site configurations
│   ├── brands.yaml         # Brand normalization
│   └── currencies.yaml     # Currency settings
│
├── tests/                  # Unit tests
│   ├── price-parser.test.js
│   ├── intent-parser.test.js
│   └── normalizers.test.js
│
├── outputs/                # Generated outputs
│   ├── results/
│   └── screenshots/
│
└── logs/                   # Application logs
```

## Running Tests

```bash
# Run all tests
npm test

# Run specific test file
node --test tests/price-parser.test.js
```

## Legal & Ethical Considerations

- This tool is designed for **personal/internal use only**
- Respects robots.txt and implements rate limiting
- Does not bypass CAPTCHAs or access controls
- Scraping may violate Terms of Service of target sites
- Use responsibly and at your own risk

## License

MIT
