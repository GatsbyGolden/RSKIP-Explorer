# RSKIP Explorer

A small static site for reviewing and sorting Rootstock Improvement Proposals from [rsksmart/RSKIPs](https://github.com/rsksmart/RSKIPs).

- Loads every `IPs/RSKIP*.md` file straight from GitHub on page load, so it stays current with no rebuilds.
- Defaults to **Upcoming** (Draft + Accepted). Filter by status, purpose, layer, complexity; full-text search; click any column to sort; click a row for the abstract.
- Filters and sort are kept in the URL, so a filtered view can be shared as a link.
- `data.json` is a bundled snapshot used only if GitHub can't be reached. Refresh it with `node build-snapshot.js /path/to/RSKIPs`.

Unofficial; not maintained by the RSKIP authors.
