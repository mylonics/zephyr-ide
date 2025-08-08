# Zephyr IDE REST API

The Zephyr IDE extension includes an optional REST API server that allows AI agents and external tools to interact with Zephyr IDE functionality programmatically.

## Configuration

The API server can be configured through VS Code settings:

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `zephyr-ide.api_server_enabled` | boolean | `false` | Enable the REST API server |
| `zephyr-ide.api_server_port` | number | `8080` | Port for the API server to listen on |
| `zephyr-ide.api_server_key` | string | `null` | Optional API key for authentication (leave empty to disable auth) |

### Example Configuration

```json
{
  "zephyr-ide.api_server_enabled": true,
  "zephyr-ide.api_server_port": 8080,
  "zephyr-ide.api_server_key": "your-secret-api-key"
}
```

## Authentication

If an API key is configured, all requests must include one of the following headers:
- `X-API-Key: your-secret-api-key`
- `Authorization: Bearer your-secret-api-key`

## API Endpoints

All API responses follow this format:

```json
{
  "success": true|false,
  "data": {...},
  "error": "error message",
  "message": "status message"
}
```

### GET /api/status

Get the current status of the Zephyr IDE extension.

**Response:**
```json
{
  "success": true,
  "data": {
    "version": "1.10.12",
    "initialized": true,
    "westUpdated": true,
    "activeProject": "my_project",
    "activeBuild": "debug",
    "rootPath": "/path/to/workspace",
    "zephyrDir": "/path/to/zephyr"
  }
}
```

### GET /api/projects

List all projects in the workspace.

**Response:**
```json
{
  "success": true,
  "data": {
    "my_project": {
      "name": "my_project",
      "rel_path": "projects/my_project",
      "buildConfigs": {
        "debug": {
          "board": "nucleo_f103rb",
          "runner": "openocd",
          "conf_files": ["prj.conf"],
          "overlay_files": ["debug.overlay"]
        }
      }
    }
  }
}
```

### POST /api/projects

Create a new project (initiates the interactive project creation process).

**Request Body:**
```json
{
  "name": "new_project",
  "template": "hello_world",
  "location": "optional/path"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Project creation initiated"
}
```

### GET /api/projects/{projectName}/builds

Get build configurations for a specific project.

**Response:**
```json
{
  "success": true,
  "data": {
    "debug": {
      "board": "nucleo_f103rb",
      "runner": "openocd",
      "conf_files": ["prj.conf"],
      "overlay_files": ["debug.overlay"]
    }
  }
}
```

### POST /api/projects/{projectName}/builds

Add a new build configuration to a project (initiates the interactive build configuration process).

**Request Body:**
```json
{
  "projectName": "my_project",
  "buildName": "release",
  "board": "nucleo_f103rb",
  "runner": "openocd",
  "conf_files": ["prj.conf", "release.conf"],
  "overlay_files": []
}
```

**Response:**
```json
{
  "success": true,
  "message": "Build configuration addition initiated"
}
```

### POST /api/build

Trigger a build for the specified project and build configuration.

**Request Body:**
```json
{
  "projectName": "my_project",
  "buildName": "debug",
  "pristine": false
}
```

If `projectName` and `buildName` are omitted, the currently active project/build will be used.

**Response:**
```json
{
  "success": true,
  "message": "Build completed",
  "data": {
    "result": "build output details"
  }
}
```

### POST /api/flash

Flash the built firmware to the target device.

**Request Body:**
```json
{
  "projectName": "my_project",
  "buildName": "debug"
}
```

If `projectName` and `buildName` are omitted, the currently active project/build will be used.

**Response:**
```json
{
  "success": true,
  "message": "Flash completed"
}
```

### GET /api/workspace/config

Get the current workspace configuration (sanitized for security).

**Response:**
```json
{
  "success": true,
  "data": {
    "initialSetupComplete": true,
    "rootPath": "/path/to/workspace",
    "activeProject": "my_project",
    "projects": ["my_project", "another_project"],
    "projectStates": {
      "my_project": {
        "activeBuildConfig": "debug",
        "activeTwisterConfig": null
      }
    }
  }
}
```

## Usage Examples

### Python Example

```python
import requests

# Configure API client
api_base = "http://localhost:8080/api"
headers = {"X-API-Key": "your-secret-api-key"}

# Get extension status
response = requests.get(f"{api_base}/status", headers=headers)
status = response.json()
print(f"Extension version: {status['data']['version']}")

# List projects
response = requests.get(f"{api_base}/projects", headers=headers)
projects = response.json()
print(f"Projects: {list(projects['data'].keys())}")

# Build a project
build_request = {
    "projectName": "my_project",
    "buildName": "debug",
    "pristine": False
}
response = requests.post(f"{api_base}/build", json=build_request, headers=headers)
print(f"Build result: {response.json()['message']}")
```

### curl Examples

```bash
# Get status
curl -H "X-API-Key: your-secret-api-key" http://localhost:8080/api/status

# List projects
curl -H "X-API-Key: your-secret-api-key" http://localhost:8080/api/projects

# Build project
curl -X POST \
  -H "X-API-Key: your-secret-api-key" \
  -H "Content-Type: application/json" \
  -d '{"projectName": "my_project", "buildName": "debug", "pristine": false}' \
  http://localhost:8080/api/build
```

## Error Handling

Error responses include a `success: false` field and an `error` message:

```json
{
  "success": false,
  "error": "Project not found"
}
```

Common HTTP status codes:
- `200` - Success
- `400` - Bad Request (invalid input)
- `401` - Unauthorized (missing or invalid API key)
- `404` - Not Found (endpoint or resource not found)
- `500` - Internal Server Error

## Security Considerations

- The API server only listens on localhost by default
- Use a strong API key in production environments
- Consider firewall rules if exposing the API beyond localhost
- The workspace configuration endpoint returns sanitized data to avoid exposing sensitive information

## Limitations

- Some operations (like project creation) initiate interactive processes that may require user intervention
- The API server runs within the VS Code extension host process
- Build and flash operations are asynchronous; check the output channel for detailed progress