#!/bin/bash

# =============================================================================
# CashCrawler - Setup Script
# =============================================================================
#
# This script installs all dependencies needed to run CashCrawler:
# - Node.js dependencies
# - Playwright browsers
# - Ollama (for OCR)
# - minicpm-v model (for OCR)
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
# 3. Ollama (for OCR)
# -----------------------------------------------------------------------------

echo "🔍 Checking for Ollama..."

if command -v ollama &> /dev/null; then
    echo "✓ Ollama is already installed"
else
    echo "⚠️  Ollama is not installed."
    echo ""
    echo "Ollama is required for OCR (reading virtual keyboard buttons)."
    echo "Please install it from: https://ollama.ai/download"
    echo ""
    
    # Detect OS and provide specific instructions
    if [[ "$OSTYPE" == "darwin"* ]]; then
        echo "For macOS, you can install with:"
        echo "  brew install ollama"
        echo ""
        echo "Or download from: https://ollama.ai/download/mac"
    elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
        echo "For Linux, run:"
        echo "  curl -fsSL https://ollama.ai/install.sh | sh"
    fi
    
    echo ""
    read -p "Press Enter after installing Ollama to continue, or Ctrl+C to exit..."
fi

# -----------------------------------------------------------------------------
# 4. Start Ollama (if not running)
# -----------------------------------------------------------------------------

echo "🚀 Checking if Ollama is running..."

if ! pgrep -x "ollama" > /dev/null; then
    echo "Starting Ollama service..."
    ollama serve &> /dev/null &
    sleep 2
fi

echo "✓ Ollama is running"
echo ""

# -----------------------------------------------------------------------------
# 5. Pull minicpm-v model
# -----------------------------------------------------------------------------

echo "🤖 Checking for minicpm-v model..."

if ollama list | grep -q "minicpm-v"; then
    echo "✓ minicpm-v model is already installed"
else
    echo "📥 Downloading minicpm-v model (~5.5GB)..."
    echo "   This may take a few minutes depending on your connection."
    echo ""
    ollama pull minicpm-v
    echo "✓ minicpm-v model installed"
fi

echo ""

# -----------------------------------------------------------------------------
# 6. Environment File
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
