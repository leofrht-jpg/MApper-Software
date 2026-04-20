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
