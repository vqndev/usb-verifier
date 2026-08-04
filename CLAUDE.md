# usb-verifier

Vite static site (WebHID/Serial device verifier for the L-Tron mDLR).

## Deploy

Deploys to GitHub Pages at https://vqndev.github.io/usb-verifier/ automatically.
Just commit and push to `main` — the `.github/workflows/deploy.yml` Actions workflow
builds and publishes. No manual deploy step, no VPS. A new push cancels any
in-flight deploy run, so watch the latest run: `gh run list --limit 1`.

Version shown in the header comes from `package.json` — bump it with
`npm version <x.y.z> --no-git-tag-version` before releasing.
