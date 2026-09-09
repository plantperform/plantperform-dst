# PLA-48: Liste og kort på samme side

Status: design valgt 09-09-2026 (Retning A, "Delt visning", 50/50 som standard). Bygges på `feat/pla-48-liste-og-kort` oven på PLA-51. Kun frontend.

## Problem

Liste og kort er to sider, man skifter imellem. De viser de samme marker, men deler intet: listen har sin valgte række, kortet sin valgte mark, og skiftet nulstiller det, man stod med. Målet (Daniel, PLA-48) er et arbejdsområde, hvor liste og kort peger på samme markering, og hvor man klikker sig rundt i færrest mulige visninger.

## Løsning i korte træk

Liste og kort ligger side om side under årsgennemgangen, adskilt af en skillelinje med faste stop. Liste og Kort er skillelinjens to yderpunkter, Delt er standard. Hover, valgt mark, valgt år og fremhævet kystvandopland er en og samme tilstand for begge ruder.

## Layout

- Indholdskolonnen (under topbaren, med 12 px luft) rummer oppefra: årsgennemgang (kun simulering), en stribe med kystvandopland-chips, og den delte flade.
- Den delte flade er en ny `FarmSplitView`: listerude (egen lodret scroll, `@container`), `SplitDivider`, kortrude (fast højde via `flex-1 min-h-0`).
- Skillelinjen: pointer-træk, snap inden for 24 px til 1/3, 1/2 og 2/3, dobbeltklik nulstiller til 1/2, piletaster flytter 16 px, `role="separator"` med `aria-valuenow`. Under træk lægges et gennemsigtigt lag over kortet, så canvas ikke sluger pointer-events. Minimum: liste 420 px, kort 360 px. Trækkes en rude under sit minimum, snapper den lukket, og visningen følger med (Liste eller Kort), så der er en tilstand, ikke to.
- Topbarens kontrol får tre valg: Liste | Delt | Kort. Delt genskaber den gemte delingsgrad. Delt er slået fra under 800 px indre bredde med titlen "Skærmen er for smal til delt visning".
- Visning og listens andel af den delte flade gemmes pr. browser (`plantperform.farmView`, `plantperform.farmSplitFraction`) efter mønstret i `sidebar-width.ts`. Første gang er Delt standard, hvis der er plads.
- Fra 1280 px indre bredde dokkes markpanelet som en 460 px kolonne mellem liste og kort. Under det lægger panelet sig over listeruden med glid ind fra venstre, en "Liste"-tilbageknap, forrige/næste mark i sorteringsrækkefølgen og "Zoom til mark". Listen forbliver monteret bagved, så scroll og sortering overlever. Beregningsgennemgangen udvider panelet til `min(950px, 100%)` af den delte flade hen over listeruden; kortet kollapser aldrig til 0 px.

## Fælles tilstand

| Tilstand | Ejer | Note |
|---|---|---|
| `selectedFieldId` | FarmDetailPage | uændret, men nulstilles ikke længere ved skift til Kort |
| `selectedYearIndex` | FarmDetailPage | uændret |
| `view` ('list' / 'split' / 'map') | FarmDetailPage via `useSplitLayout` | gemmes pr. browser |
| `listFraction` (0-1) | `useSplitLayout` | listens andel af den delte flade, gemmes pr. browser |
| `hoveredFieldId` | FarmInspector | ikke i siden, så sidebaren ikke re-renderes |
| `highlightedCatchmentKey` | FarmInspector | toggle fra opland-chips |
| `zoomRequest` {fieldId, nonce} | FarmInspector | fra markpanel og dobbeltklik på række |

Kortet bliver kontrolleret: `selectedFieldId`/`onSelectedFieldChange` som props, dets eget "valgt mark"-kort (FieldStat) og "Fjern mark" fra kortet udgår; Fjern mark sker fra markpanelet. Add mode-udvalget (registermarker) forbliver lokalt i kortet.

## Synkronisering

- Hover, række til kort: rækken sætter `hoveredFieldId`; kortet tegner marken i et `hover-farm-field` GeoJSON-source, der spejler `selected-farm-field` (fyld +0,2 opacity, outline 3 px). Ingen kortbevægelse ved hover.
- Hover, kort til række: kortets hover-handler sætter `hoveredFieldId` (rAF-throttlet); rækken får `bg-muted/60`. Listen scroller aldrig ved hover.
- Valg, række til kort: klik på række sætter `selectedFieldId`; kortet fremhæver via de eksisterende `selected-farm-field`-lag og panorerer kun (easeTo, 500 ms, uændret zoom), hvis markens bounds er uden for `map.getBounds()`. Zoom ændres aldrig automatisk. Dobbeltklik på række = vælg + zoom til mark.
- Valg, kort til række: klik på polygon sætter `selectedFieldId`; rækken markeres og `scrollIntoView({ block: 'nearest' })`; markpanelet åbner. Klik på tomt kort eller Escape lukker panelet.
- Valgt år: som i dag, men kortet er synligt hele tiden, så årets farvelægning og afgrødepiller følger med det samme. `yearValuesEnabled` bliver `selectedYearIndex !== null && (view !== 'list' || selectedFieldId !== null)`.
- Kystvandopland-chips: klik fremhæver oplandet (`aria-pressed`, ring): rækker uden for oplandet dæmpes til `opacity-50` uden at filtrere, så tabelfodens totaler står fast; kortet dæmper polygoner uden for oplandet (fill-opacity 0,12) og laver `fitBounds` til oplandets marker. Klik igen eller Escape rydder. Escape-rækkefølge: markpanel, derefter opland, år kun med fokus i årsgennemgangens radiogroup.
- Find mark i sidebaren: vælger marken og forlader kun regler-tilstand; den tvinger ikke længere Liste. Resultat: rækken markeres og scrolles til, polygonen fremhæves og panoreres ind, markpanelet åbner.
- Zoom til mark: knap i markpanelets header og dobbeltklik på række kalder `fitBounds(markens bounds, padding 64, maxZoom 16, 500 ms)` via `zoomRequest`. "Vis alle" på kortet gør det modsatte med `getFieldsBounds(fields)`.
- Regler-tilstand: klik på polygon scroller til rækken og giver den fokus, så Lås/Lås op er et tastetryk væk. `SimulationRulesPanel` ligger over listen i listeruden.
- Tilføj marker fra registret (kun afgrødehistorik): mens add mode kører, snapper fladen til Kort-yderpunktet og gendanner bredden ved Færdig/Annuller. Tilføj-kortet indsnævres til `w-72` med CVR-blokken bag en `DisclosureButton`. Den tomme listes "Åbn kortvisning" udgår; teksten henviser til Tilføj marker på kortet.

## Tabellen

- To tætheder styret af listerudens bredde (container query): fuld (dagens) og kompakt. Kompakt: `px-3`, sædskifte-tern uden afgrødenavne, Afgrøde-kolonnen kun når et år er valgt, DB2 forkortet med "t.kr". Enheder og Areal beholdes altid. Vandret scroll inde i tabelcontaineren, hvis kolonner ikke kan være der.
- Sticky header og footer; tabelcontaineren er den lodrette scroller.
- Rækker er en memoiseret `FieldRow` med `isHovered`/`isSelected`, så hover på 200 rækker ikke re-renderer tabellen.
- Kolonner-menuen og legenden bliver i listeruden; kystvandopland-chips flytter op i striben over den delte flade.

## Kortets kontroller

- Det 18 rem store "Farvelæg marker"-kort erstattes af en 36 px `MapToolbar` over canvas: Farvelæg (select), Lag (popover med "Vis afgrødenavne for {år}" og Grøn Trepart), Vis alle, og Tilføj marker (kun afgrødehistorik).
- En 24 px legendestribe i bunden af canvas viser den aktive farvelægnings bins.
- MapLibre `NavigationControl` (zoom, uden kompas) øverst til højre. Hover-popup, afgrødepiller pr. år, låsemarkører og MARS-lag er uændrede.

## Årsgennemgang

- Altid sammenfoldelig. Sammenfoldet header (44 px) viser de otte årstal som chips i en radiogroup med samme tastatur som søjlerne, og en tal-linje for det valgte år, så man kan skifte år uden at folde søjlerne ud.
- Kompakt tæthed (søjler h-20) når viewport-højden er under 960 px. Standard sammenfoldet når viewport-højden er under 800 px.

## Uændret

FarmTopBar (bortset fra kontrollen), FarmSidebar, SimulationRulesPanel, ManualRotationEditor, RotationDetailPanel, dialoger, backend og API. Ingen nye endpoints.

## Rækkefølge (en commit pr. trin)

1. `FarmView` får 'split', `FarmSplitView`, `SplitDivider`, `useSplitLayout` med persistens, tre-valgs kontrol, list og kort side om side.
2. Kortet kontrolleret: `selectedFieldId` som prop, hover-source, `zoomRequest`, panorering kun uden for viewport, FieldStat-kortet fjernes; `changeView` og Find mark nulstiller/tvinger ikke længere.
3. Markpanelet ud af `FarmFieldsList` og ind i `FarmSplitView`: overlay under 1280 px, dokket fra 1280 px; tilbage, forrige/næste, Zoom til mark; Fjern mark-dialog og sædskifte-editor følger med.
4. `MapToolbar`, legendestribe, Lag-popover, `NavigationControl`, tilføj-kortet indsnævret og Kort-snap i add mode.
5. Tabellen: kompakt tæthed, sticky header/footer, `scrollIntoView` ved valg, hover-rækker, memoiseret række, dobbeltklik til zoom.
6. Kystvandopland-striben med fremhævning, årsgennemgangens sammenfoldede chips, kompakt tæthed og standard efter højde.
7. Regler-tilstandens kortklik, Escape-rækkefølge, Delt slået fra under 800 px, QA på 1366, 1440, 1536 og 1920.

## Kendte risici

- Lodret plads på 1366x768: med sidebar 320 px er den indre flade 1022 x 692 px. Sammenfoldet årsgennemgang som standard og chips i headeren giver ca. 12 rækker.
- MapLibre resize under træk kan hakke på integreret grafik. Fallback: flyt først ruderne ved pointerup.
- Hover på mange rækker kræver memoiserede rækker og rAF-throttling.
- Automatisk panorering må ikke opleves som at kortet stikker af: kun når marken er uden for viewporten, aldrig automatisk zoom.
