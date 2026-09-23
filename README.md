# RSKIP Explorer

Browse, filter and sort every Rootstock Improvement Proposal from [rsksmart/RSKIPs](https://github.com/rsksmart/RSKIPs). A static site with no build step and no dependencies, hosted on GitHub Pages.

- Opens on **Upcoming** (Draft + Accepted). Filter by status, layer and complexity, search titles, authors and abstracts, and sort any column. Filters live in the URL, so a view can be shared as a link.
- A **How RSKIPs work** tab summarises [RSKIP-0](https://github.com/rsksmart/RSKIPs/blob/master/IPs/RSKIP0.md). Link to it with `#guide`.
- Styled with the [Rootstock brand system](https://github.com/rsksmart/rootstock-brand-system). Light mode by default, dark mode on request.

## How the data stays current

1. The page renders straight from `data.json`, a snapshot of every proposal.
2. It then asks the GitHub API for the repo's file list and compares git blob SHAs with the snapshot. Only new or changed proposals are downloaded, so a typical visit makes **one** request to GitHub.
3. If GitHub is unreachable or rate-limited, the snapshot stays on screen and the status line says so.
4. `.github/workflows/refresh-data.yml` rebuilds `data.json` every day at 03:17 UTC and commits only when something changed. Run it by hand from the Actions tab.

GitHub pauses scheduled workflows in public repos after 60 days without any commits. If that happens the site still stays current (it checks GitHub on every visit), only the snapshot ages. Re-enable it from the Actions tab.

## Files

| File | Purpose |
| --- | --- |
| `index.html` | Markup, including the guide content |
| `app.css` | Styles (Rootstock Published palette for light, Editor palette for dark) |
| `app.js` | UI, filtering, sorting and GitHub sync (ES module) |
| `rskip.js` | RSKIP markdown parser, shared by the browser and the daily job |
| `build-snapshot.js` | Builds `data.json` from a local clone: `node build-snapshot.js /path/to/RSKIPs` |
| `data.json` | Generated snapshot. Don't edit by hand |
| `fonts/` | Rootstock Sans (MIT, see `fonts/LICENSE.md`) |

## Security

- Strict Content Security Policy: scripts, styles and fonts load only from this site, and network access is limited to `api.github.com` and `raw.githubusercontent.com`. No third-party scripts, cookies or trackers.
- Proposal text is untrusted input. It's parsed as plain text and HTML-escaped before display, and the parser uses null-prototype objects.
- The workflow pins actions to full commit SHAs, uses least-privilege permissions, and refuses to overwrite `data.json` if the upstream repo suddenly looks broken.

## Run locally

```sh
python3 -m http.server 8000   # then open http://localhost:8000
```

Unofficial; not maintained by the RSKIP editors.
