# Milestone 1 — Business Brief, Location and Positioning

**Status:** Draft complete for implementation planning. No code and no production operations.

## Working identity

- **Name:** Žemaitija Country Escapes (working brand; no formal name/trademark clearance claimed)
- **Descriptor:** Rural Stays & Online Booking
- **Service area:** fictional countryside property in the Plateliai area of Plungė District, Lithuania
- **Public positioning:** an independent countryside retreat with three differentiated units
- **Languages:** Lithuanian first, English and German equivalents
- **Business model:** direct accommodation booking with secure online payment, balance reminders and governed cancellations
- **Portfolio positioning:** transactional hospitality platform demonstrating payment systems, inventory consistency, international UX and operational workflows

## Location decision and factual basis

Use **Plateliai** as the real reference locality. The town is at the western shore of Lake Plateliai and hosts the Žemaitija National Park visitor centre; the national park's official site lists nearby real attractions and walking/cycling opportunities.

**Do not fabricate a property address or misleading property pin.** At Milestone 1, fix the public locality at Plateliai/Plungė District. An approximate map marker may show the area, clearly labeled as illustrative rather than the booked accommodation's real entrance. No claim of beachfront location, lake view, park permission or distance from an unspecified fictional property.

The park is a protected area. If a later deliverable places the fictional site inside its boundary, regulatory suitability must be researched separately; do not imply planning permission.

## Intended customer segments

- Lithuanian couples/weekend travellers
- Families and small groups
- German- and English-speaking visitors to Lithuania
- Nature, cycling and cultural travellers

No invented visitor interviews or market size estimates.

## Stays: working content entities

| Stable internal key | Public working name | Capacity | Differentiation |
|---|---|---:|---|
| `forest-cottage` | Forest Cottage | 2 | Quiet couple-oriented stay |
| `lakeside-cabin` | Lakeside Cabin | 2 | Nature-oriented styling; no unverified direct lake access |
| `family-cottage` | Family Cottage | 6 | Family space and shared facilities |

Properties such as Wi-Fi, kitchens, sauna access, accessibility, pet policy, cancellation terms, check-in and prices must be defined centrally and checked for consistency before publishing.

## Brand and visual principles

- Calm editorial Baltic countryside direction
- Natural off-white, forest green, stone, warm timber and restrained lake-blue accents
- Readable sans UI text and refined editorial headings
- Strong photography with truthful illustrative imagery disclosure
- Clear booking CTA and easy price/comparison access
- Avoid generic resort luxury claims, large SaaS cards, gimmicks or fake reviews

## Business critical distinction from Project 1

This is **not** an enquiry-only demonstration. It must be a genuinely executable booking lifecycle using fictional inventory and real provider **test-mode** transactions, with a secure admin area and automated operations.

## Milestone 1 acceptance

- [x] Working fictional operator and three units defined
- [x] Real reference locality selected and verified against official park information
- [x] Public-location honesty constraints written down
- [x] LT/EN/DE supported in the master brief
- [x] Real payments prohibited in portfolio mode
- [x] Financial policy boundaries in scope
- [x] Legal review and open design gates identified
- [ ] Final brand clearance (optional before portfolio publication; required before real registration)
- [ ] Final design of property amenities and rates (Milestone 6)
- [ ] Exact map display treatment approved (before location page implementation)

## Credible tourism research sources

- https://zemaitijosnpd.lrv.lt/en/information-for-visitors/places-to-visit/plateliai/
- https://zemaitijosnpd.lrv.lt/en/information-for-visitors/places-to-visit/lake-plateliai/
- https://zemaitijosnpd.lrv.lt/en/information-for-visitors/places-to-visit/
- https://vstt.lrv.lt/en/lithuanian-protected-areas/national-parks/

## Next milestone

Milestone 2 — formal booking/payment/cancellation state and domain specification **before** writing code.
