# AGENTS.md - Santa Fe Compras Monitor

Technical notes for whoever (human or AI) touches this actor next.

## What this actor does

Extracts public tenders (licitaciones, contrataciones) from the Province
of Santa Fe, Argentina's official procurement system, with full detail per
process - description, rubros, organism, and direct document links
(pliego, resolucion, acta de apertura, etc).

## Architecture

The simplest of this portfolio's actors so far, for a real reason: the
site's own search page (`gestionesdecompras/site/index.php`) drives a
read-only JSON API (`AppAjax.php?a=consultas.getContrataciones`) via plain
query-string GET requests - no ViewState, no postback, no session state,
no proxy needed (verified live: reachable from a plain datacenter IP).

- `src/fetchListing.ts` - pages through the JSON API per `estado` code
  (`AP`=Apertura Proxima, `ET`=En Tramite, `CO`=Concluido - verified live
  against the response's own `extraData.{ap,et,co}Total` breakdown).
  `anio` was tested as a filter parameter and doesn't appear to change
  results in any observable way, so it's deliberately omitted rather than
  implying a filter that doesn't work.
- `src/fetchDetail.ts` + `src/parsers/detail.ts` - fetches and parses each
  process's detail page (plain server-rendered HTML, no JS). The page is a
  flat sequence of `<div class="col-12 mb-4">` blocks: most are
  `<b>Label:</b><span>Value</span>` pairs, a few (Rubros / Subrubros,
  Organismo comitente) use one or more bare `<div>` for potentially
  multiple values, and a distinct block holds `<h4>Documentos</h4>` +
  `<h5>Tipo</h5>` headers each followed by `<div><a></a></div>` document
  links. `parseDetail` handles all three shapes.
- `src/http.ts` - shared fetch-with-retry helper, native `fetch()`, no
  proxy, exponential backoff for transient failures only.
- `src/main.ts` - for each selected `estado`, lists then (optionally, on
  by default) fetches full detail per process, pushes + charges per item.

## Known scope limits (disclosed, not hidden)

- `anio` (year) is not exposed as an input filter - tested live and it
  doesn't appear to change the API's response, so exposing it would imply
  a filter that doesn't actually work.
- `fetchDetail: true` (default) adds one extra HTTP request per process.
  For a `maxItems` covering the full `ET`/`CO` backlog (1000+ each), this
  is a real cost/time multiplier - `fetchDetail: false` gives a
  listing-only fast path when the extra detail isn't needed.

## Sibling candidates (from the same parallel audit that found this target)

Tucuman, Entre Rios and Salta all came back `viable` from the same
6-province live audit that found this target (2026-09-04) - plain
HTML/PHP, zero DevExpress/AJAX markers. Mendoza also viable but more
fragile (runs COMPR.AR; the results grid itself is a plain GridView
reachable via POST, but its own pagination mechanism was not confirmed
live before this was written - do that first). Neuquen was rejected:
GeneXus AJAX+WebSocket tied to session state, not reproducible with plain
fetch/cheerio. Full audit notes in that session's workflow journal, not
copied into any repo - re-verify live before building the next one rather
than trusting old notes, since these sites can and do change.
