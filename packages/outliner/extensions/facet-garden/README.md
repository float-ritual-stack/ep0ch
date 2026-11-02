# Garden seed facets

A fictional catalogue whose rows live outside the outline. Install this example, then open
`tile.open kind=facets source=ext.facet-garden.seeds`.

Pick **family → beans** to include both kinds, then **colour → red** for Runner beans.
The usual include/exclude picks, query line, calendar and saved searches work here.
`facets.source source=notes` returns to the outline's notes; `source=trail` explores visits.

- **The source:** the manifest's `facetSources` points to a read action returning rows with open property names.
- **The narrowing:** the shared query grammar and facet counter do it. These catalogue rows have no open action.
- **Uninstalling** removes the source; saved searches remain ordinary notes.
