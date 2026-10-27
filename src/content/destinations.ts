import type { Locale } from '@/i18n/routing';
export type LocalizedText = Record<Locale, string>;
export type DestinationGroup = 'local' | 'regional' | 'excursion';
export type DestinationCategory = 'nature' | 'walking' | 'viewpoint' | 'heritage' | 'culture' | 'pilgrimage' | 'history' | 'excursion';
export type Destination = { id: string; group: DestinationGroup; category: DestinationCategory; name: LocalizedText; area: LocalizedText; description: LocalizedText; source: string; reviewedOn: string; disposition: 'verified' | 'qualified' | 'text-only' };
export type DestinationMarker = { destinationId: string; latitude: number; longitude: number; source: string; meaning: LocalizedText; reviewedOn: string };
/** Audited against docs/design/m17-phase-b/VERIFICATION_GATE.md. No visitor facilities, prices, hours, accommodation coordinates or inferred entrance points. */
export const destinations = [
  {
    "id": "L01",
    "group": "local",
    "category": "nature",
    "name": {
      "lt": "Platelių ežeras",
      "en": "Lake Plateliai",
      "de": "Plateliai-See"
    },
    "area": {
      "lt": "Plateliai, Žemaitijos nacionalinis parkas",
      "en": "Plateliai, Žemaitija National Park",
      "de": "Plateliai, Nationalpark Žemaitija"
    },
    "description": {
      "lt": "Žemaitijos nacionalinio parko ežerų kraštovaizdis. Žemėlapyje pažymėta vieša apžvalgos aikštelė, o ne apgyvendinimo vieta.",
      "en": "Lake scenery in Žemaitija National Park. The map marks the public viewpoint, not accommodation.",
      "de": "Seenlandschaft im Nationalpark Žemaitija. Die Karte zeigt den öffentlichen Aussichtspunkt, keine Unterkunft."
    },
    "source": "https://zemaitijosnp.lt/veikla/lankytini-objektai/plateliu-ezeras/",
    "reviewedOn": "2026-10-27",
    "disposition": "verified"
  },
  {
    "id": "L02",
    "group": "local",
    "category": "walking",
    "name": {
      "lt": "Šeirės gamtos takas",
      "en": "Šeirė Nature Trail",
      "de": "Naturpfad Šeirė"
    },
    "area": {
      "lt": "Plateliai",
      "en": "Plateliai",
      "de": "Plateliai"
    },
    "description": {
      "lt": "Pėsčiųjų takas per Šeirės mišką ir pelkių kraštovaizdį Platelių kraštovaizdžio draustinyje.",
      "en": "A walking trail through Šeirė forest and wetland landscapes in Plateliai landscape reserve.",
      "de": "Ein Wanderpfad durch den Wald von Šeirė und Feuchtgebiete im Landschaftsschutzgebiet Plateliai."
    },
    "source": "https://zemaitijosnp.lt/veikla/pesciujudviraciu-takai/seires-takas/",
    "reviewedOn": "2026-10-27",
    "disposition": "verified"
  },
  {
    "id": "L03",
    "group": "local",
    "category": "heritage",
    "name": {
      "lt": "Beržoras",
      "en": "Beržoras",
      "de": "Beržoras"
    },
    "area": {
      "lt": "Plungės rajonas",
      "en": "Plungė district",
      "de": "Bezirk Plungė"
    },
    "description": {
      "lt": "Istorinis kaimas su medine bažnyčia ir Kryžiaus kelio koplyčiomis.",
      "en": "A historic village with a wooden church and Stations of the Cross chapels.",
      "de": "Ein historisches Dorf mit einer Holzkirche und Kreuzwegkapellen."
    },
    "source": "https://zemaitijosnp.lt/veikla/lankytini-objektai/berzoras/",
    "reviewedOn": "2026-10-27",
    "disposition": "text-only"
  },
  {
    "id": "L04",
    "group": "local",
    "category": "viewpoint",
    "name": {
      "lt": "Siberijos apžvalgos bokštas",
      "en": "Siberija Viewing Tower",
      "de": "Aussichtsturm Siberija"
    },
    "area": {
      "lt": "Cidabro kalnas, Plungės rajonas",
      "en": "Cidabras hill, Plungė district",
      "de": "Cidabras-Hügel, Bezirk Plungė"
    },
    "description": {
      "lt": "Apžvalgos bokštas, iš kurio matyti ežerai ir Siberijos pelkė.",
      "en": "A viewing tower overlooking lakes and the Siberija wetland.",
      "de": "Ein Aussichtsturm mit Blick auf Seen und das Feuchtgebiet Siberija."
    },
    "source": "https://zemaitijosnp.lt/veikla/lankytini-objektai/siberijos-apzvalgos-bokstas/",
    "reviewedOn": "2026-10-27",
    "disposition": "verified"
  },
  {
    "id": "L05",
    "group": "local",
    "category": "history",
    "name": {
      "lt": "Šaltojo karo ekspozicija",
      "en": "Cold War Exposition",
      "de": "Ausstellung zum Kalten Krieg"
    },
    "area": {
      "lt": "Plokščiai, Plungės rajonas",
      "en": "Plokščiai, Plungė district",
      "de": "Plokščiai, Bezirk Plungė"
    },
    "description": {
      "lt": "Ekspozicija buvusioje Sovietų Sąjungos raketų bazėje. Žemėlapio taškas žymi lankytojų centrą.",
      "en": "An exposition at a former Soviet missile installation. The map point identifies its visitor centre.",
      "de": "Eine Ausstellung in einer ehemaligen sowjetischen Raketenbasis. Der Kartenpunkt bezeichnet das Besucherzentrum."
    },
    "source": "https://zemaitijosnp.lt/en/expositions/",
    "reviewedOn": "2026-10-27",
    "disposition": "verified"
  },
  {
    "id": "L06",
    "group": "local",
    "category": "heritage",
    "name": {
      "lt": "Platelių dvaro parkas",
      "en": "Plateliai Manor Park",
      "de": "Gutspark Plateliai"
    },
    "area": {
      "lt": "Plateliai",
      "en": "Plateliai",
      "de": "Plateliai"
    },
    "description": {
      "lt": "Išlikęs dvaro parkas su senais medžiais ir sudegusių centrinių rūmų pamatų liekanomis.",
      "en": "A surviving manor park with veteran trees and foundations of the burned central palace.",
      "de": "Ein erhaltener Gutspark mit alten Bäumen und Fundamentresten des abgebrannten Hauptpalastes."
    },
    "source": "https://zemaitijosnp.lt/veikla/lankytini-objektai/plateliu-dvaro-parkas/",
    "reviewedOn": "2026-10-27",
    "disposition": "text-only"
  },
  {
    "id": "L07",
    "group": "local",
    "category": "pilgrimage",
    "name": {
      "lt": "Žemaičių Kalvarija",
      "en": "Žemaičių Kalvarija",
      "de": "Žemaičių Kalvarija"
    },
    "area": {
      "lt": "Plungės rajonas",
      "en": "Plungė district",
      "de": "Bezirk Plungė"
    },
    "description": {
      "lt": "Piligrimystės miestelis, žinomas bazilika ir Kryžiaus kelio tradicija.",
      "en": "A pilgrimage town known for its basilica and Stations of the Cross tradition.",
      "de": "Ein Wallfahrtsort mit Basilika und lebendiger Kreuzwegtradition."
    },
    "source": "https://zemaitijosnp.lt/veikla/lankytini-objektai/zemaiciu-kalvarija/",
    "reviewedOn": "2026-10-27",
    "disposition": "text-only"
  },
  {
    "id": "R01",
    "group": "regional",
    "category": "culture",
    "name": {
      "lt": "Telšiai",
      "en": "Telšiai",
      "de": "Telšiai"
    },
    "area": {
      "lt": "Telšiai",
      "en": "Telšiai",
      "de": "Telšiai"
    },
    "description": {
      "lt": "Telšių senamiestis kviečia pažinti regiono miesto kultūrą.",
      "en": "Telšiai Old Town offers an introduction to the region’s urban culture.",
      "de": "Die Altstadt von Telšiai eröffnet einen Zugang zur Stadtkultur der Region."
    },
    "source": "https://visit.telsiai.lt/en/sightseeing-places/telsiai-old-town/",
    "reviewedOn": "2026-10-27",
    "disposition": "text-only"
  },
  {
    "id": "R02",
    "group": "regional",
    "category": "culture",
    "name": {
      "lt": "Žemaičių muziejus „Alka“",
      "en": "Samogitian Museum Alka",
      "de": "Samogitisches Museum Alka"
    },
    "area": {
      "lt": "Telšiai",
      "en": "Telšiai",
      "de": "Telšiai"
    },
    "description": {
      "lt": "Muziejus Telšiuose, skirtas Žemaitijos istorijai ir kultūrai.",
      "en": "A museum in Telšiai dedicated to Samogitian history and culture.",
      "de": "Ein Museum in Telšiai zur Geschichte und Kultur Samogitiens."
    },
    "source": "https://visit.telsiai.lt/en/event-place/samogitian-museum-alka/",
    "reviewedOn": "2026-10-27",
    "disposition": "text-only"
  },
  {
    "id": "R03",
    "group": "regional",
    "category": "heritage",
    "name": {
      "lt": "Žemaičių kaimo muziejus",
      "en": "Samogitian Village Museum",
      "de": "Samogitisches Dorfmuseum"
    },
    "area": {
      "lt": "Telšiai",
      "en": "Telšiai",
      "de": "Telšiai"
    },
    "description": {
      "lt": "Muziejaus „Alka“ padalinys po atviru dangumi, pristatantis tradicinę kaimo architektūrą.",
      "en": "Alka’s open-air branch presenting traditional rural architecture.",
      "de": "Die Freilichtabteilung des Alka-Museums zeigt traditionelle ländliche Architektur."
    },
    "source": "https://visit.telsiai.lt/en/sightseeing-places/exposition-of-samogitian-museum-alka-in-samogitian-village/",
    "reviewedOn": "2026-10-27",
    "disposition": "text-only"
  },
  {
    "id": "R04",
    "group": "regional",
    "category": "culture",
    "name": {
      "lt": "Mykolo Oginskio rūmai",
      "en": "Mykolas Oginskis Palace",
      "de": "Palast von Mykolas Oginskis"
    },
    "area": {
      "lt": "Plungė",
      "en": "Plungė",
      "de": "Plungė"
    },
    "description": {
      "lt": "Neorenesansiniai rūmai Plungės dvaro sodyboje.",
      "en": "A neo-Renaissance palace within the Plungė manor estate.",
      "de": "Ein Neorenaissancepalast im Gutsensemble von Plungė."
    },
    "source": "https://www.zdm.lt/plunges-dvaro-sodyba/",
    "reviewedOn": "2026-10-27",
    "disposition": "text-only"
  },
  {
    "id": "R05",
    "group": "regional",
    "category": "culture",
    "name": {
      "lt": "Kretingos žiemos sodas",
      "en": "Kretinga Winter Garden",
      "de": "Wintergarten Kretinga"
    },
    "area": {
      "lt": "Kretinga",
      "en": "Kretinga",
      "de": "Kretinga"
    },
    "description": {
      "lt": "Žiemos sodas Kretingos muziejaus ir Tiškevičių dvaro komplekse.",
      "en": "The Winter Garden within Kretinga Museum and the Tiškevičiai manor complex.",
      "de": "Der Wintergarten im Komplex des Museums Kretinga und des Tiškevičiai-Gutshofs."
    },
    "source": "https://www.kretingosmuziejus.lt/lt/opening-hours/",
    "reviewedOn": "2026-10-27",
    "disposition": "text-only"
  },
  {
    "id": "R06",
    "group": "regional",
    "category": "viewpoint",
    "name": {
      "lt": "Šatrijos kalnas",
      "en": "Šatrija Hill",
      "de": "Šatrija-Hügel"
    },
    "area": {
      "lt": "Pašatrija, Telšių rajonas",
      "en": "Pašatrija, Telšiai district",
      "de": "Pašatrija, Bezirk Telšiai"
    },
    "description": {
      "lt": "Piliakalnis Žemaitijos aukštumose prie Pašatrijos kaimo.",
      "en": "A hillfort in the Samogitian uplands near Pašatrija village.",
      "de": "Ein Burgberg im samogitischen Hochland beim Dorf Pašatrija."
    },
    "source": "https://visit.telsiai.lt/lankytinos-vietos/pasatrijos-piliakalnis-satrija/",
    "reviewedOn": "2026-10-27",
    "disposition": "qualified"
  },
  {
    "id": "R07",
    "group": "regional",
    "category": "heritage",
    "name": {
      "lt": "Biržuvėnų dvaras",
      "en": "Biržuvėnai Manor",
      "de": "Gutshof Biržuvėnai"
    },
    "area": {
      "lt": "Biržuvėnai, Telšių rajonas",
      "en": "Biržuvėnai, Telšiai district",
      "de": "Biržuvėnai, Bezirk Telšiai"
    },
    "description": {
      "lt": "Medinio dvaro paveldas Biržuvėnuose.",
      "en": "Wooden manor heritage at Biržuvėnai.",
      "de": "Hölzerne Gutsarchitektur in Biržuvėnai."
    },
    "source": "https://visit.telsiai.lt/en/info/about-us/",
    "reviewedOn": "2026-10-27",
    "disposition": "text-only"
  },
  {
    "id": "E01",
    "group": "excursion",
    "category": "pilgrimage",
    "name": {
      "lt": "Kryžių kalnas",
      "en": "Hill of Crosses",
      "de": "Berg der Kreuze"
    },
    "area": {
      "lt": "Šiaulių rajonas",
      "en": "Šiauliai district",
      "de": "Bezirk Šiauliai"
    },
    "description": {
      "lt": "Tikėjimo, atminties ir pasipriešinimo vieta Šiaulių rajone. Ši piligrimystės vieta turi visos Lietuvos reikšmę.",
      "en": "A place of faith, remembrance and resistance in Šiauliai district. This pilgrimage site has significance across Lithuania.",
      "de": "Ein Ort des Glaubens, des Gedenkens und des Widerstands im Bezirk Šiauliai. Dieser Wallfahrtsort hat Bedeutung für ganz Litauen."
    },
    "source": "https://www.visitsiauliai.lt/en/sightseeing-places/the-hill-of-crosses/",
    "reviewedOn": "2026-10-27",
    "disposition": "qualified"
  },
  {
    "id": "E02",
    "group": "excursion",
    "category": "excursion",
    "name": {
      "lt": "Palanga",
      "en": "Palanga",
      "de": "Palanga"
    },
    "area": {
      "lt": "Baltijos pakrantė",
      "en": "Baltic coast",
      "de": "Ostseeküste"
    },
    "description": {
      "lt": "Pakrantės išvyka: Gintaro muziejus Tiškevičių rūmuose, Birutės parke.",
      "en": "A coastal excursion: the Amber Museum in Tiškevičiai Palace, Birutė Park.",
      "de": "Ein Ausflug an die Küste: das Bernsteinmuseum im Tiškevičiai-Palast im Birutė-Park."
    },
    "source": "https://www.visit-palanga.lt/en/sightseeing-places/palanga-amber-museum/",
    "reviewedOn": "2026-10-27",
    "disposition": "text-only"
  },
  {
    "id": "E03",
    "group": "excursion",
    "category": "heritage",
    "name": {
      "lt": "Kurtuvėnai",
      "en": "Kurtuvėnai",
      "de": "Kurtuvėnai"
    },
    "area": {
      "lt": "Šiaulių rajonas",
      "en": "Šiauliai district",
      "de": "Bezirk Šiauliai"
    },
    "description": {
      "lt": "Dvaro ir kraštovaizdžio paveldas Kurtuvėnuose, Šiaulių rajone.",
      "en": "Manor and landscape heritage at Kurtuvėnai in Šiauliai district.",
      "de": "Guts- und Landschaftserbe in Kurtuvėnai im Bezirk Šiauliai."
    },
    "source": "https://www.visitsiauliai.lt/data/ckfinder/files/Saules_zemes%20tturtai%20_EN(1).pdf",
    "reviewedOn": "2026-10-27",
    "disposition": "text-only"
  }
] as const satisfies readonly Destination[];
export const destinationMarkers = [
  {
    "destinationId": "L01",
    "latitude": 56.04704,
    "longitude": 21.828335,
    "source": "https://zemaitijosnp.lt/veikla/lankytini-objektai/plateliu-ezero-apzvalgos-aikstele/",
    "meaning": {
      "lt": "Platelių ežero apžvalgos aikštelė",
      "en": "Lake Plateliai viewpoint",
      "de": "Aussichtspunkt am Plateliai-See"
    },
    "reviewedOn": "2026-10-27"
  },
  {
    "destinationId": "L02",
    "latitude": 56.048411,
    "longitude": 21.827357,
    "source": "https://zemaitijosnp.lt/veikla/pesciujudviraciu-takai/seires-takas/",
    "meaning": {
      "lt": "Šeirės tako pradžia",
      "en": "Šeirė trail start",
      "de": "Start des Šeirė-Pfads"
    },
    "reviewedOn": "2026-10-27"
  },
  {
    "destinationId": "L04",
    "latitude": 56.030465,
    "longitude": 21.814336,
    "source": "https://zemaitijosnp.lt/veikla/lankytini-objektai/siberijos-apzvalgos-bokstas/",
    "meaning": {
      "lt": "Siberijos apžvalgos bokštas",
      "en": "Siberija Viewing Tower",
      "de": "Aussichtsturm Siberija"
    },
    "reviewedOn": "2026-10-27"
  },
  {
    "destinationId": "L05",
    "latitude": 56.030391,
    "longitude": 21.906232,
    "source": "https://zemaitijosnp.lt/en/expositions/",
    "meaning": {
      "lt": "Šaltojo karo ekspozicijos lankytojų centras",
      "en": "Cold War Exposition visitor centre",
      "de": "Besucherzentrum der Ausstellung zum Kalten Krieg"
    },
    "reviewedOn": "2026-10-27"
  }
] as const satisfies readonly DestinationMarker[];
export const destinationGroups: readonly DestinationGroup[] = ['local', 'regional', 'excursion'];
export function findDestination(id: string | undefined) { return destinations.find(destination => destination.id === id); }
