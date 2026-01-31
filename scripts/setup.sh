#!/bin/bash

# =============================================================================
# CashCrawler - Setup Script
# =============================================================================
#
# This script installs all dependencies needed to run CashCrawler:
# - Node.js dependencies
# - Playwright browsers
#
# Usage: npm run setup
# =============================================================================

set -e  # Exit on error

echo "🏦 CashCrawler - Setup"
echo "======================"
echo ""

# -----------------------------------------------------------------------------
# 1. Node.js Dependencies
# -----------------------------------------------------------------------------

echo "📦 Installing Node.js dependencies..."
npm install
echo "✓ Node.js dependencies installed"
echo ""

# -----------------------------------------------------------------------------
# 2. Playwright Browsers
# -----------------------------------------------------------------------------

echo "🌐 Installing Playwright browsers..."
npx playwright install chromium
echo "✓ Playwright browsers installed"
echo ""

# -----------------------------------------------------------------------------
# 3. Environment File
# -----------------------------------------------------------------------------

echo "📝 Checking for .env file..."

if [ -f ".env" ]; then
    echo "✓ .env file exists"
else
    echo "Creating .env file from template..."
    cat > .env << 'EOF'
# Caisse d'Épargne credentials
CE_USERNAME=your_user_id
CE_PASSWORD=your_password

# UAF Life credentials (optional)
UAF_USERNAME=your_user_id
UAF_PASSWORD=your_password
EOF
    echo "✓ .env file created"
    echo ""
    echo "⚠️  Please edit .env and add your bank credentials before running."
fi

echo ""

# -----------------------------------------------------------------------------
# Done!
# -----------------------------------------------------------------------------

echo "================================"
echo "✅ Setup complete!"
echo "================================"
echo ""
echo "Next steps:"
echo "  1. Edit .env with your bank credentials"
echo "  2. Run: npm run ce:balances     # Get Caisse d'Épargne balances"
echo "  3. Run: npm run ce:transactions # Download transaction history"
echo ""
echo "For more information, see README.md"
