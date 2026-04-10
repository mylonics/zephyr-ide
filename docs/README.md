# IDE for Zephyr Documentation

This directory contains the source files for the IDE for Zephyr documentation, built using [Astro Starlight](https://starlight.astro.build/).

## Viewing the Documentation

The documentation is published at: https://zephyr-ide.mylonics.com/

## Building the Documentation Locally

### Prerequisites

- Node.js 18+
- npm

### Installation

Install the required dependencies:

```bash
cd docs
npm install
```

### Build the Documentation

To build the static site:

```bash
npm run build
```

The generated HTML files will be in the `dist/` directory.

### Serve the Documentation Locally

To preview the documentation with live reloading:

```bash
npm run dev
```

Then open your browser to http://localhost:4321/

## Documentation Structure

The documentation source files are in `src/content/docs/` and organized into the following sections:

- **Getting Started** (`src/content/docs/getting-started/`) - Installation and initial setup
  - Installation
  - Setup Panel
  - Host Tools
  - Workspace Configuration
  - SDK Installation
  - External Environments

- **User Guide** (`src/content/docs/user-guide/`) - How to use IDE for Zephyr
  - Project Setup
  - Building and Debugging
  - Testing with Twister
  - Sharing Your Code
  - Other Features

- **Reference** (`src/content/docs/reference/`) - Detailed reference information
  - Commands
  - Configuration Settings
  - Launch Configuration Helpers
  - Extension Pack
  - Known Issues

- **Changelog** - Release notes and version history
- **Developer Guide** - Contributing to IDE for Zephyr

## Contributing to the Documentation

The documentation source files are in Markdown/MDX format located in `src/content/docs/`. To contribute:

1. Edit the relevant `.md` or `.mdx` files in `src/content/docs/`
2. Preview your changes with `npm run dev`
3. Submit a pull request

### Adding New Pages

To add a new page:

1. Create a new `.md` file in the appropriate subdirectory under `src/content/docs/`
2. Add a `title` and optional `description` to the frontmatter
3. Add the page to the sidebar in `astro.config.mjs`
4. Build and preview to verify

## Deployment

Documentation is automatically built and deployed to GitHub Pages when changes are pushed to the `main` branch via the `.github/workflows/deploy-docs.yml` workflow.

## Theme

This documentation uses [Astro Starlight](https://starlight.astro.build/) which provides:

- Clean, modern documentation design
- Built-in dark/light mode toggle
- Full-text search (powered by Pagefind)
- Responsive layout
- Syntax highlighting for code blocks
- Automatic table of contents
- Previous/Next page navigation

