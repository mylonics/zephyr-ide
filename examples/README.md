# Zephyr IDE API Examples

This directory contains example scripts and clients for interacting with the Zephyr IDE REST API.

## Files

### `api-client.py`
A Python client library and interactive example script for the Zephyr IDE API.

**Prerequisites:**
- Python 3.6+
- `requests` library: `pip install requests`

**Usage:**
```bash
python3 api-client.py
```

The script will prompt for an API key and then demonstrate various API operations.

### `test-api.sh`
A bash script using curl to test API endpoints.

**Prerequisites:**
- `curl` command
- `python3` (optional, for JSON formatting)

**Usage:**
```bash
# Test without authentication
./test-api.sh

# Test with API key
./test-api.sh your-api-key

# Test with API key on custom port
./test-api.sh your-api-key 8081
```

## Configuration

Before using these examples, make sure to enable the API server in VS Code settings:

```json
{
  "zephyr-ide.api_server_enabled": true,
  "zephyr-ide.api_server_port": 8080,
  "zephyr-ide.api_server_key": "your-secret-api-key"
}
```

## API Documentation

For complete API documentation, see [../docs/API.md](../docs/API.md).