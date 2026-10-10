# Commercial / tiny retail spaces (Seattle grocery mart idea)

## Short answer

**No — this MCP should not be the tool for leasing a small market space.**

Long-term **residential** rentals (apartments, houses) and **commercial** retail
leases share a few human concepts (location, size, monthly cost), but they do
**not** share inventory, endpoints, or brokers. Stuffing both into
`rentals-search-mcp` would muddy tool names and burn the wrong quota.

## Why RentCast won’t cover it

From RentCast’s own property-types docs:

> At this time, we do not provide data for office, retail, industrial,
> manufacturing, farm or other non-residential commercial properties.

So a “tiny grocery mart” lease in Seattle (Ballard, Beacon Hill, Columbia City,
etc.) will not appear in `/listings/rental/long-term` no matter how you filter
beds/baths.

## What *would* cover it

Typical commercial sources (research when you want a sibling package):

| Source | Notes |
| --- | --- |
| [Crexi](https://www.crexi.com/) | Marketplace + API/partner paths for commercial listings |
| [LoopNet](https://www.loopnet.com/) / CoStar | Dominant US commercial MLS-ish inventory; APIs are partner/enterprise |
| Local brokers / NN listings | Often the real path for micro-retail in Seattle |
| City / SDCI / DPD zoning | Not a listings API — but needed before you sign anything |

A future package might look like `commercial-search-mcp` with host id
`commercial` and tools such as:

| Tool | Intent |
| --- | --- |
| `spaces_search` | City/neighborhood + sqft + rent/NNN filters |
| `spaces_get` | One space by id |
| `link_format` | Crexi / LoopNet search URL fallback |

That is intentionally a **different** `{service}_*` noun (`spaces_` not
`listings_`) so Qwen / host repair do not confuse apartment hunts with retail
leases.

## Param overlap (why it feels similar)

| Concept | Residential MCP | Commercial MCP (future) |
| --- | --- | --- |
| Where | city, state, zip, lat/lng, radius | same idea; often neighborhood / submarket |
| Size | bedrooms, bathrooms, sqft | **sqft** (+ frontage, grade-level, loading) |
| Money | monthly rent | base rent + **NNN** / CAM / utilities |
| Type | Apartment, Single Family, … | retail, restaurant, office, industrial |
| Tenure | 12-mo lease common | 3–10 yr + options common |

Same *shape*, different schema → different package, different host server id.

## Recommendation for Tim

1. Ship **residential** `rentals-search-mcp` first (friends’ apartment hunts).
2. Keep the grocery-mart idea as a v2 **sibling** once you pick a commercial
   data source you can legally automate.
3. Until then: use broker sites + zoning research; don’t pretend RentCast covers
   retail.

## Seattle micro-retail reality check (non-API)

Useful even without an MCP:

- Zoning / use (food retail, grocery) via Seattle SDCI / parcel tools
- Foot traffic corridors vs quiet residential stretches
- NNN vs modified-gross — “cheap” base rent can still be expensive
- Health department / food establishment requirements if selling groceries

None of that belongs in the residential RentCast client.
