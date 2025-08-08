#!/bin/bash
#
# Example curl commands to test the Zephyr IDE REST API
# 
# Usage: ./test-api.sh [API_KEY] [PORT]
#

API_KEY="${1:-}"
PORT="${2:-8080}"
BASE_URL="http://localhost:$PORT/api"

echo "Testing Zephyr IDE REST API at $BASE_URL"
echo "============================================="

# Prepare headers
if [ -n "$API_KEY" ]; then
    HEADERS="-H 'X-API-Key: $API_KEY'"
    echo "Using API key: $API_KEY"
else
    HEADERS=""
    echo "No API key provided"
fi

echo

# Test 1: Get status
echo "1. Testing GET /api/status"
echo "curl $HEADERS $BASE_URL/status"
eval "curl -s $HEADERS $BASE_URL/status" | python3 -m json.tool 2>/dev/null || eval "curl -s $HEADERS $BASE_URL/status"
echo -e "\n"

# Test 2: List projects
echo "2. Testing GET /api/projects"
echo "curl $HEADERS $BASE_URL/projects"
eval "curl -s $HEADERS $BASE_URL/projects" | python3 -m json.tool 2>/dev/null || eval "curl -s $HEADERS $BASE_URL/projects"
echo -e "\n"

# Test 3: Get workspace config
echo "3. Testing GET /api/workspace/config"
echo "curl $HEADERS $BASE_URL/workspace/config"
eval "curl -s $HEADERS $BASE_URL/workspace/config" | python3 -m json.tool 2>/dev/null || eval "curl -s $HEADERS $BASE_URL/workspace/config"
echo -e "\n"

# Test 4: Test authentication (should fail without key if key is required)
if [ -n "$API_KEY" ]; then
    echo "4. Testing authentication (should fail without API key)"
    echo "curl $BASE_URL/status"
    curl -s "$BASE_URL/status" | python3 -m json.tool 2>/dev/null || curl -s "$BASE_URL/status"
    echo -e "\n"
fi

# Test 5: Test CORS preflight
echo "5. Testing OPTIONS /api/status (CORS preflight)"
echo "curl -X OPTIONS $BASE_URL/status"
curl -s -X OPTIONS "$BASE_URL/status" -w "HTTP Status: %{http_code}\n"
echo

echo "API testing completed!"
echo
echo "To use with API key: $0 your-api-key"
echo "To use different port: $0 your-api-key 8081"