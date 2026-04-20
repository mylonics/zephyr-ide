# IDE for Zephyr Documentation

Source for the IDE for Zephyr documentation site, built with [Astro Starlight](https://starlight.astro.build/).

Published at: https://zephyr-ide.mylonics.com/

## Building locally

Requires Node.js 18+.

```bash
cd docs
npm install
npm run dev    # live preview at http://localhost:4321/
npm run build  # static site in dist/
```

The shared Mylonics theme lives in a sibling repo. For local development, clone it once into `docs/mylonics-styles/`:

```bash
git clone https://github.com/mylonics/mylonics-styles.git mylonics-styles
```

CI does this automatically.

## Structure

Pages live in `src/content/docs/` and are organized to match the sidebar in `astro.config.mjs`:

- `getting-started/` — installation, setup panel, host tools, workspace, SDK, external environments
- `user-guide/` — projects, building & debugging, Twister testing, sharing, advanced features
- `reference/` — commands, settings, launch configuration helpers, extension pack, known issues
- `whats-new-3-0.md` — 3.0 release highlights
- `changelog.md` — pointer to the repository CHANGELOG
- `developer-guide.md` — contributing, build, and release process

## Other documentation in this folder

- `upstream/ide_for_zephyr.rst` — RST page intended for submission to the upstream Zephyr project documentation (`zephyr/doc/develop/tools/`). It is not part of the published Astro site.
- `media/` — screenshots and GIFs referenced from the README and the docs site.

## Contributing

1. Edit the relevant `.md` / `.mdx` file under `src/content/docs/`.
2. If adding a new page, register it in the sidebar in `astro.config.mjs`.
3. Preview with `npm run dev` and open a pull request.

## Deployment

Pushes to `main` deploy via `.github/workflows/deploy-docs.yml`.
