# Proposed map treatment

**A map helps guests understand destinations; it never locates the fictional accommodation.** All generated-board maps are composition studies. Their roads, shorelines, positions and shapes are not geographic data. The content inventory and the coordinate evidence below override generated pixels.

## Identity and geographic truth

Use Timber Index Paper, Forest and muted rules. Give real attraction markers a filled circle and an accessible destination name; a trail marker must say “trail start”, a viewpoint must say “viewpoint”, and a museum visitor-centre marker must say “visitor centre”. A settlement is not an entrance. Avoid hotel, bed, building or house symbols for the fictional brand.

If locality is included, show **a broad dashed illustrative region with no centre marker**, labelled “Plateliai area · Fictional locality; no property location”. Its boundary is a design annotation, not the property extent, an administrative district, a national-park boundary or a search radius. Do not store it as an accommodation geometry or route origin. Prefer an adjacent text locality note on narrow screens. No property street address, numeric coordinates, individual cottage markers, geolocation, accommodation-origin directions, distance sorting, travel-time rings or route lines.

For A, the regional map follows the landscape opening. Use a short local list alongside it and keep the dedicated Hill of Crosses feature independent of marker readiness. For B, a quiet map closes the cultural chapters rather than competing with the opening story. For C, the directory drives the map; on mobile, default to a readable list and expose a deliberate Map view. Selecting a row reveals the same named detail on mobile as desktop, with an explicit back-to-list action. The raster proposals are not interaction specifications.

## Coordinate evidence

WGS84 decimal degrees, **latitude then longitude**. Source pages sometimes print longitude first; values were normalized by their explicit WGS labels and Lithuanian location ranges, not geocoded from memory.

| Destination marker / function | Latitude | Longitude | Source |
| --- | ---: | ---: | --- |
| Lake Plateliai viewpoint | 56.047040 | 21.828335 | [Park viewpoint](https://zemaitijosnp.lt/veikla/lankytini-objektai/plateliu-ezero-apzvalgos-aikstele/) |
| Šeirė Nature Trail start | 56.048411 | 21.827357 | [Park trail](https://zemaitijosnp.lt/veikla/pesciujudviraciu-takai/seires-takas/) |
| Siberija Viewing Tower | 56.030465 | 21.814336 | [Park tower](https://zemaitijosnp.lt/veikla/lankytini-objektai/siberijos-apzvalgos-bokstas/) |
| Cold War Exposition visitor centre | 56.030391 | 21.906232 | [Park expositions](https://zemaitijosnp.lt/en/expositions/) |

[Coordinate relationship diagram](map-reference.svg) plots these four points using a local equirectangular relationship (longitude scaled by cos 56°). It has **no basemap, roads, trails, site outlines or routing advice**. This supplementary diagram is not a substitute for the three high-fidelity compositions. Its separate dashed note demonstrates fictional-locality semantics without asserting an extent on the plotted geography.

**Hill of Crosses is editorially required, but its production map pin is blocked:** [regional guide, PDF p.17](https://www.visitsiauliai.lt/data/ckfinder/files/Saules_zemes%20tturtai%20_EN(1).pdf) reports 56.015850, 23.415565; [tourism webpage](https://www.visitsiauliai.lt/en/sightseeing-places/the-hill-of-crosses/) links to a map query at 56.019358, 23.432064. Do not average or choose one by eye. Reconcile the attraction/visitor access point with the authority. Text feature and official-information link do not depend on a pin. All other attractions with only verified addresses/localities remain list-only until entrance/pin verification is recorded. No fabricated coordinates fill the gaps.

## Future semantic and technical behaviour — after approval

The project brief proposes Leaflet/OpenStreetMap. No library, data source or service is installed in Phase A. A later implementation must confirm provider terms, attribution and data licensing separately. OpenStreetMap credit is not a blanket license for third-party tiles, tourism photography or map fonts. Do not copy a commercial basemap into production from the generated boards.

Provide the same official source links and destination summaries in the ordinary document list, available without JavaScript, map tiles, pointer input or consent. Use destination-specific accessible names such as “Official visitor information for Beržoras”. Interactive markers require keyboard access, focus visibility and a clear close/back action; never require pin selection to reach booking. Explain unavailable map loading and retain the list if tiles fail. Zoom controls and List/Map controls need 44px+ targets; destination selection and filter changes need a text status where relevant. No user location request by default.

The full header keeps visible language links and accommodation/booking navigation. Repeated map labels are localized display strings, never IDs. Lithuanian default, English and German receive equivalent distinctions between real attractions and fictional locality. Raster English labels are review intent; translations and 200% reflow remain Phase B work. Proposed visitors links go to the independent operator's source rather than suggesting experiences can be booked with this fictional accommodation brand.
