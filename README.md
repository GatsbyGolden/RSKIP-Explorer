# RSKIP Explorer

A small static site for reviewing and sorting Rootstock Improvement Proposals from [rsksmart/RSKIPs](https://github.com/rsksmart/RSKIPs).

- Loads every `IPs/RSKIP*.md` file straight from GitHub on page load, so it stays current with no rebuilds.
- Defaults to **Upcoming** (Draft + Accepted). Filter by status, purpose, layer, complexity; full-text search; click any column to sort; click a row for the abstract.
- Filters and sort are kept in the URL, so a filtered view can be shared as a link.
- `data.json` is a snapshot shown instantly while the live data loads, and used if GitHub can't be reached. A GitHub Action (`.github/workflows/refresh-data.yml`) rebuilds it every day at 03:00 UTC; you can also run it by hand from the Actions tab.

Styled with the [Rootstock brand system](https://github.com/rsksmart/rootstock-brand-system) (Rootstock Sans fonts, logo and palette, MIT licensed). Light mode uses the Published palette and dark mode the Editor palette; it follows the system setting, with a toggle in the top bar.

Unofficial; not maintained by the RSKIP authors.
