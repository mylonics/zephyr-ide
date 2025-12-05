# Zephyr IDE Documentation

This directory contains the source files for the Zephyr IDE documentation, built using [MkDocs](https://www.mkdocs.org/) with the [Cinder](https://sourcefoundry.org/cinder/) theme.

## Viewing the Documentation

The documentation is published at: https://mylonics.github.io/zephyr-ide/

## Building the Documentation Locally

### Prerequisites

- Python 3.x
- pip

### Installation

Install the required dependencies:

```bash
pip install -r requirements-docs.txt
```

### Build the Documentation

To build the static site:

```bash
mkdocs build
```

The generated HTML files will be in the `site/` directory.

### Serve the Documentation Locally

To preview the documentation with live reloading:

```bash
mkdocs serve
```

Then open your browser to http://127.0.0.1:8000/zephyr-ide/

## Documentation Structure

The documentation is organized into the following sections:

- **Getting Started** - Installation and initial setup
  - Installation
  - Setup Panel
  - Host Tools
  - Workspace Configuration
  - SDK Installation
  - Externally Managed Environments

- **User Guide** - How to use Zephyr IDE
  - Setting Up Projects
  - Building and Debugging
  - Testing with Twister
  - Sharing Your Code
  - Other Features

- **Reference** - Detailed reference information
  - Commands
  - Configuration Settings
  - Launch Configuration Helpers
  - Extension Pack
  - Known Issues

- **Changelog** - Release notes and version history

- **Developer Guide** - Contributing to Zephyr IDE

## Contributing to the Documentation

The documentation source files are in Markdown format and located in the `docs/` directory. To contribute:

1. Edit the relevant `.md` files in the `docs/` directory
2. Preview your changes with `mkdocs serve`
3. Submit a pull request

### Adding New Pages

To add a new page:

1. Create a new `.md` file in the appropriate subdirectory under `docs/`
2. Add the page to the navigation in `mkdocs.yml`
3. Build and preview to verify

## Deployment

Documentation is automatically built and deployed to GitHub Pages when changes are pushed to the `main` branch via the `.github/workflows/deploy-docs.yml` workflow.

## Theme

This documentation uses the Cinder theme with GitHub color scheme. The theme provides:

- Clean, modern design
- Responsive layout
- Syntax highlighting for code blocks
- Search functionality

## Markdown Extensions

The following Markdown extensions are enabled:

- Table of contents with permalinks
- Admonitions (notes, warnings, tips)
- Code highlighting
- Definition lists
- Footnotes
- Tables
- PyMdown Extensions (superfences, details, tabbed, etc.)
