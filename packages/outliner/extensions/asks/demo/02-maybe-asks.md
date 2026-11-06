Maybe asks [query::maybe-needs NOT status=done NOT work-stage=done NOT work-stage=superseded] [property-scope::all]
[type::virtual-branch] [summary-properties::maybe-needs] [limit::50]

- **What it holds:** lines the review was unsure about, each opened at its line.
- **Not on your waiting list:** promote one by writing `[needs::sysop: why]` on it.
