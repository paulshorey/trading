#!/bin/bash

# Test WebSocket functionality by sending strength data to the API
# This will trigger a WebSocket event that should appear in real-time on the monitoring page

echo "Testing WebSocket with strength data..."

# Test data with different intervals
curl -X POST http://localhost:3001/api/v1/market?access_key=testkeyx \
  -H "Content-Type: text/plain" \
  -d "ETHUSD 75.5 @ 5m price=3250.50 volume=1234567"

sleep 1

curl -X POST http://localhost:3001/api/v1/market?access_key=testkeyx \
  -H "Content-Type: text/plain" \
  -d "BTCUSD 82.3 @ 15m price=67890.25 volume=9876543"

sleep 1

curl -X POST http://localhost:3001/api/v1/market?access_key=testkeyx \
  -H "Content-Type: text/plain" \
  -d "SOLUSD -45.2 @ 1h price=145.75 volume=456789"

echo ""
echo "Test data sent! Check http://localhost:3000/realtime for live updates"
