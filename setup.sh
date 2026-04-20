#!/bin/bash
set -e

echo "=== MApper Setup ==="
echo ""

# Check prerequisites
command -v conda >/dev/null 2>&1 || { echo "❌ conda not found. Install Miniconda first: https://docs.conda.io/en/latest/miniconda.html"; exit 1; }
command -v node >/dev/null 2>&1 || { echo "❌ Node.js not found. Install from https://nodejs.org (v18+)"; exit 1; }

# Create conda environment
echo "📦 Creating conda environment 'map'..."
conda create -n map python=3.11 -y 2>/dev/null || echo "Environment 'map' already exists"
eval "$(conda shell.bash hook)"
conda activate map

# Install Python dependencies
echo "📦 Installing Python packages..."
cd mapper-backend
pip install -r requirements.txt --break-system-packages -q
cd ..

# Install Node dependencies
echo "📦 Installing frontend packages..."
cd mapper-frontend
npm install --silent
cd ..

# Create start script
cat > start.sh << 'EOF'
#!/bin/bash
eval "$(conda shell.bash hook)"
conda activate map

# Start backend
cd mapper-backend
uvicorn mapper.main:app --reload --port 8000 &
BACKEND_PID=$!
cd ..

# Start frontend
cd mapper-frontend
npm run dev &
FRONTEND_PID=$!
cd ..

echo ""
echo "✅ MApper is running!"
echo "   Open: http://localhost:5173"
echo "   Press Ctrl+C to stop"
echo ""

# Wait and cleanup
trap "kill $BACKEND_PID $FRONTEND_PID 2>/dev/null" EXIT
wait
EOF
chmod +x start.sh

echo ""
echo "✅ Setup complete!"
echo ""
echo "To start MApper:"
echo "   ./start.sh"
echo ""
echo "To import ecoinvent:"
echo "   1. Start MApper"
echo "   2. Go to Database Explorer"
echo "   3. Click Import → select your ecoinvent .7z file"
echo ""
echo "To configure premise (optional, for prospective LCA):"
echo "   mkdir -p ~/.premise"
echo "   echo 'YOUR_KEY' > ~/.premise/premise_key"
echo "   Request a key from romain.sacchi@psi.ch"
