# CashCrawler

An open-source tool to download your own bank data (balances and transactions). Take control of your financial data without relying on third-party services.

https://github.com/user-attachments/assets/080f8bc0-ccc5-4f2c-bf46-9b106ae73400

## Why This Project?

I wanted to track my finances automatically, but I care about **privacy** and **data ownership**. I didn't want to:

- Pay for external services that hold my data
- Give all my information to third parties with access to bank APIs
- Manually record every transaction (tedious and incomplete)

Banks don't provide APIs to their users, so I built one myself. This tool lets you download your own data and store it locally, giving you full control.

**What you can do with your data:**

- Track spending trends over time
- Identify recurring charges you might have forgotten
- Build your own dashboards and reports
- Never miss small transactions that go under the radar

## Features

- **Balance retrieval**: Get current balances for all your accounts
- **Transaction history**: Download up to 2+ years of transaction history as CSV (builds up over time!)
- **Smart caching**: Skips downloads if data was already retrieved today
- **Privacy-first**: All data stays on your machine
- **Extensible**: Easy to add new bank connectors

## Supported Banks

| Bank                      | Balances | Transactions |
| ------------------------- | -------- | ------------ |
| Caisse d'Épargne (France) | ✅       | ✅           |
| UAF Life Patrimoine       | ✅       | ❌           |

## Prerequisites

- **Node.js** 18+ ([download](https://nodejs.org/))
- **Ollama** - Local AI runtime for OCR ([download](https://ollama.ai/download))
- **minicpm-v** model (~5.5GB) - Installed automatically by setup script

> **Why Ollama?** Some banks (like Caisse d'Épargne) use virtual keyboards with randomized button positions. We use OCR to read which digit is on each button.

## Quick Start

### 1. Clone and Setup

```bash
git clone https://github.com/fabrahaingo/cashcrawler.git
cd cashcrawler

# Run the setup script (installs everything)
npm run setup
```

The setup script will:

- Install Node.js dependencies
- Install Playwright browsers
- Check for Ollama (with install instructions if missing)
- Download the minicpm-v model
- Create a `.env` file template

### 2. Configure Credentials

Edit the `.env` file with your bank credentials:

```env
# Caisse d'Épargne
CE_USERNAME=your_user_id
CE_PASSWORD=your_password

# UAF Life (optional)
UAF_USERNAME=your_user_id
UAF_PASSWORD=your_password
```

### 3. Run

```bash
# Get account balances
npm run ce:balances

# Download transaction history (up to 792 days for Caisse d'Épargne)
npm run ce:transactions

# UAF Life balances
npm run uaf:balances
```

## Data Storage

All data is stored locally in the `data/` directory:

```
data/
├── balances/
│   └── ce/
│       └── 2024-01-15.json      # Daily balance snapshots
└── transactions/
    └── ce/
        ├── compte_courant/
        │   └── history-from-20231115.csv
        ├── livret_a/
        │   └── history-from-20231115.csv
        └── ...
```

### Balance Format (JSON)

```json
{
  "date": "2024-01-15",
  "timestamp": "2024-01-15T10:30:00.000Z",
  "balances": [
    { "account": "Compte Courant", "balance": 1234.56 },
    { "account": "Livret A", "balance": 5000.0 }
  ]
}
```

### Transaction Format (CSV)

The CSV format matches what the bank provides, typically including:

- Date
- Description
- Amount
- etc.

## Project Structure

```
cashcrawler/
├── src/
│   ├── connectors/           # Bank-specific connectors
│   │   ├── caisse-epargne/
│   │   │   ├── config.ts     # URLs, selectors, settings
│   │   │   ├── login.ts      # Login flow with OCR
│   │   │   ├── balances.ts   # Balance extraction
│   │   │   ├── transactions.ts # Transaction download
│   │   │   └── index.ts      # Main entry point
│   │   └── uaf-life/
│   │       └── ...
│   └── lib/                  # Shared utilities
│       ├── types.ts          # Type definitions
│       ├── spinner.ts        # CLI spinner utility
│       ├── storage.ts        # File I/O operations
│       └── ocr.ts            # OCR utilities
├── scripts/
│   └── setup.sh              # Installation script
├── data/                     # Your downloaded data (gitignored)
├── .env                      # Your credentials (gitignored)
└── README.md
```

## Adding a New Bank Connector

Want to add support for your bank? Here's how:

### 1. Create the connector directory

```bash
mkdir -p src/connectors/my-bank
```

### 2. Create the required files

**`config.ts`** - URLs and selectors

```typescript
export const LOGIN_URL = "https://my-bank.com/login";
export const SELECTORS = {
  usernameInput: "#username",
  passwordInput: "#password",
  submitButton: "#submit",
};
```

**`login.ts`** - Login flow

```typescript
export async function login(page: Page, username: string, password: string) {
  // Implement login logic
}
```

**`balances.ts`** - Balance extraction

```typescript
export function extractBalances(data: any): AccountBalance[] {
  // Extract balances from page or API response
}
```

**`index.ts`** - Main entry point

```typescript
export async function getBalances() {
  // Orchestrate login and balance retrieval
}
```

### 3. Add the bank ID

In `src/lib/types.ts`:

```typescript
export const BANK_IDS = {
  CAISSE_EPARGNE: "ce",
  UAF_LIFE: "uaf",
  MY_BANK: "my-bank", // Add your bank
} as const;
```

### 4. Add npm scripts

In `package.json`:

```json
{
  "scripts": {
    "mybank:balances": "NODE_NO_WARNINGS=1 npx tsx ./src/connectors/my-bank/index.ts"
  }
}
```

## Two-Factor Authentication (2FA)

Some banks require 2FA approval on a mobile app. The script will wait up to 2 minutes for you to approve the login on your phone.

## Troubleshooting

### "Ollama is not running"

Start Ollama manually:

```bash
ollama serve
```

### "minicpm-v model not found"

Pull the model:

```bash
ollama pull minicpm-v
```

### Login fails

- Double-check your credentials in `.env`
- Make sure you're approving 2FA on your phone (if required)
- Even logged in very often during my testing, some banks may temporarily block automated access

### OCR not recognizing digits

The OCR can occasionally make mistakes. The code includes cleanup logic to handle common errors, but if it persists:

- Ensure Ollama is running
- Try restarting Ollama: `ollama serve`

## Roadmap

- [ ] Add more services (Bourse direct, Revolut, etc.)
- [ ] API to connect data to other tools like Numbers, Excel, etc...
- [ ] Automated scheduling (cron)

## Contributing

Contributions are welcome! Whether it's:

- Adding support for new banks
- Improving OCR accuracy
- Fixing bugs

Please open an issue first to discuss what you'd like to change.

## Security Notes

- **Credentials are stored locally** in `.env` (gitignored)
- **Data never leaves your machine** - no cloud services involved
- **Use at your own risk** - this tool automates browser interactions with your bank
- **Keep your `.env` file secure** - never commit it to version control

## License

MIT License - feel free to use, modify, and distribute.

---

_Built with love, Claude Code and frustration at banks not providing user APIs._
