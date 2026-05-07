# Zephyr IDE Vendor Configurations

This directory contains experimental vendor configuration support for Zephyr IDE.
Vendors can submit configurations here so that users can quickly set up vendor-specific Zephyr workspaces directly from the west workspace selector.

## Directory Structure

Each vendor gets its own subdirectory under `resources/vendors/`, and the vendor
must be registered in `resources/vendors/vendors.json`:

```
resources/vendors/
  vendors.json         # Registry — list of all registered vendor configurations
  <vendor-name>/
    west.yml           # Required — west manifest for the vendor's SDK
    host-tools.json    # Optional — additional host tools required by the vendor SDK
```

## Required Files

### `vendors.json`

The registry file that lists all vendor configurations shown in the QuickPick. Zephyr IDE
reads this file at runtime instead of scanning the directory, so every vendor entry must
be registered here:

```json
[
  {
    "id": "my-vendor",
    "displayName": "My Vendor SDK",
    "description": "Short description shown in the QuickPick",
    "url": "https://vendor.example.com/sdk",
    "maintainer": "My Company"
  }
]
```

| Field         | Required | Description                                               |
|---------------|----------|-----------------------------------------------------------|
| `id`          | Yes      | Subdirectory name under `resources/vendors/`              |
| `displayName` | No       | Label shown in the west workspace QuickPick (defaults to `id`) |
| `description` | No       | Short description shown next to the label                 |
| `url`         | No       | Link to the vendor SDK documentation or homepage          |
| `maintainer`  | No       | Name of the company or person maintaining this entry      |

### `west.yml`

A standard west manifest file that sets up the vendor's SDK workspace.
See the [west manifest documentation](https://docs.zephyrproject.org/latest/develop/west/manifest.html) for details.

## Optional Files

### `host-tools.json`

If your vendor SDK requires additional host-level tools beyond the standard Zephyr
prerequisites, provide a `host-tools.json` following the same schema as the bundled
[`src/setup_utilities/host-tools-manifest.json`](../../src/setup_utilities/host-tools-manifest.json).

When a user selects your vendor configuration, Zephyr IDE will:
1. Load and filter `host-tools.json` for the current platform and CPU architecture.
2. Show a consent dialog listing the tool names.
3. Batch-install the accepted tools using the platform package manager.

## How to Contribute

1. Fork the [zephyr-ide repository](https://github.com/mylonics/zephyr-ide).
2. Create a new subdirectory under `resources/vendors/<your-vendor-name>/`.
3. Add the required `west.yml` file.
4. Optionally add `host-tools.json` if your SDK needs extra host tools.
5. Add an entry for your vendor to `resources/vendors/vendors.json`.
6. Open a pull request against the `develop` branch.

Please ensure your `west.yml` points to a publicly accessible repository and that the
SDK is compatible with the Zephyr RTOS build system.
