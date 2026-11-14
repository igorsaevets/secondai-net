# secondai.net

The website of [AI Second Opinion](https://github.com/igorsaevets/ai-second-opinion): **https://secondai.net**.

## Nothing here is written by hand - on purpose

Every page is generated from the kit's own documents (`README.md`, `README.ru.md`, `INSTALL.md`,
`TECHNICAL.md`, `TROUBLESHOOTING.md`, `PRIVACY.md`, `SECURITY.md`, `CONTRIBUTING.md`, the newest
part of `CHANGELOG.md`) **at one release tag**, by [`scripts/sync-kit-docs.mjs`](scripts/sync-kit-docs.mjs).
A site that restates a README by hand drifts from the code; this one can only say what the release
says, and every page names the file and the release it came from.

To change a sentence on the site, change the kit's document and release the kit. A pull request
against the generated pages here has nothing to change: `src/content/docs/` is not in git.

## How a release reaches the site

The [deploy workflow](.github/workflows/deploy.yml) checks out the latest `ai-second-opinion`
release, generates the pages, builds with [Astro](https://astro.build) +
[Starlight](https://starlight.astro.build), checks the result (`scripts/check-dist.mjs`: every
internal link and anchor resolves, every link into the kit names a file the tag has, no base path
is left in) and deploys to GitHub Pages. It runs on every push here, once a day, and on demand:

```sh
gh workflow run deploy.yml -R igorsaevets/secondai-net             # the latest release
gh workflow run deploy.yml -R igorsaevets/secondai-net -f tag=v1.2.3   # a given one
```

## Local preview

Node 22.23.4 or newer.

```sh
npm ci
npm run sync -- --kit ../ai-second-opinion --tag <the tag that checkout is at>
npm run build && npm run check -- --kit ../ai-second-opinion
npm run preview
```

The sync refuses a checkout that is not exactly at the tag, or whose documents have local edits.

## Licence

MIT - see [LICENSE](LICENSE). The page text is the kit's, under the kit's MIT licence.
