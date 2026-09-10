# PLA-48: Liste og kort på samme side

Status: design valgt 09-09-2026 (Retning A, "Delt visning", listen to tredjedele og kortet en tredjedel som standard). Bygges på `feat/pla-48-liste-og-kort` oven på PLA-51. Kun frontend.

## Problem

Liste og kort er to sider, man skifter imellem. De viser de samme marker, men deler intet: listen har sin valgte række, kortet sin valgte mark, og skiftet nulstiller det, man stod med. Målet (Daniel, PLA-48) er et arbejdsområde, hvor liste og kort peger på samme markering, og hvor man klikker sig rundt i færrest mulige visninger.

## Løsning i korte træk

Liste og kort ligger side om side under årsgennemgangen, adskilt af en skillelinje med faste stop. Liste og Kort er skillelinjens to yderpunkter, Delt er standard. Hover, valgt mark, valgt år og fremhævet kystvandopland er en og samme tilstand for begge ruder.

## Layout

- Indholdskolonnen (under topbaren, med 12 px luft) rummer oppefra: årsgennemgang (kun simulering), en stribe med kystvandopland-chips, og den delte flade.
- Den delte flade er en ny `FarmSplitView`: listerude (egen lodret scroll, `@container`), `SplitDivider`, kortrude (fast højde via `flex-1 min-h-0`).
- Skillelinjen: pointer-træk, snap inden for 24 px til 1/3, 1/2 og 2/3, dobbeltklik nulstiller slækket, så listen fylder præcis det, tabellen skal bruge, piletaster flytter 16 px, `role="separator"` med `aria-valuenow`. Under træk lægges et gennemsigtigt lag over kortet, så canvas ikke sluger pointer-events. Minimum: liste 420 px, kort 360 px. Trækkes en rude under sit minimum, snapper den lukket, og visningen følger med (Liste eller Kort), så der er en tilstand, ikke to.
- Topbarens kontrol får tre valg: Liste | Delt | Kort. Delt genskaber den gemte delingsgrad. Delt er slået fra under 800 px indre bredde med titlen "Skærmen er for smal til delt visning".
- Visning og listens slæk gemmes pr. browser (`plantperform.farmView`, `plantperform.farmListSlack`) efter mønstret i `sidebar-width.ts`. Slækket er, hvor meget bredere (eller smallere, negativt) end tabellens behov listeruden skal være, som andel af den delte flade. Standard er 0, så ruden fylder præcis det, tabellen skal bruge. Første gang er Delt standard, hvis der er plads.
- Listeruden følger tabellen. Listen måler tabellens mindste bredde i fuld tæthed (i en layout-effekt lægges tabellen kortvarigt ud med bredde 0 og `data-density="full"`, og bredden aflæses inkl. ramme og lodret scrollbar) og melder den til den delte flade, som sætter rudens bredde til behovet plus slækket. Slås en kolonne til, vokser ruden med præcis kolonnens bredde, og kortet får tilsvarende mindre; slås den fra, går bredden tilbage. Et træk i skillelinjen sætter slækket, så trækket altid vinder. Kolonnevalget gemmes pr. browser og visningstype (`plantperform.farmColumns.simulation`, `plantperform.farmColumns.current`), så bredde og kolonner passer sammen efter genindlæsning. Bredden glider 250 ms, når den ikke trækkes, dog ikke ved første måling.
- Vælges en mark, lægger markpanelet sig over hele listeruden med glid ind fra venstre, en "Liste"-tilbageknap, forrige/næste mark i sorteringsrækkefølgen og "Zoom til mark", uanset skærmbredde. Listen forbliver monteret bagved, så scroll og sortering overlever. Beregningsgennemgangen udvider panelet til `min(950px, 100%)` af den delte flade hen over skillelinjen og ind over kortet; kortet kollapser aldrig til 0 px.

## Fælles tilstand

| Tilstand | Ejer | Note |
|---|---|---|
| `selectedFieldId` | FarmDetailPage | uændret, men nulstilles ikke længere ved skift til Kort |
| `selectedYearIndex` | FarmDetailPage | uændret |
| `view` ('list' / 'split' / 'map') | FarmDetailPage via `useSplitLayout` | gemmes pr. browser |
| `listSlack` (-1 til 1) | `useSplitLayout` | listens slæk i forhold til tabellens målte behov, som andel af den delte flade, gemmes pr. browser |
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
- Kystvandopland-chips: klik fremhæver oplandet (`aria-pressed`, ring): rækker uden for oplandet dæmpes til `opacity-50` uden at filtrere, så tabelfodens totaler står fast, oplandets marker lægges øverst i listen i deres hidtidige rækkefølge (10-09, Nikolais ønske), og listen scroller til toppen; kortet dæmper polygoner uden for oplandet (fill-opacity 0,12) og laver `fitBounds` til oplandets marker. Klik igen eller Escape rydder. Escape-rækkefølge: markpanel, derefter opland, år kun med fokus i årsgennemgangens radiogroup.
- Find mark i sidebaren: vælger marken og forlader kun regler-tilstand; den tvinger ikke længere Liste. Resultat: rækken markeres og scrolles til, polygonen fremhæves og panoreres ind, markpanelet åbner.
- Zoom til mark: knap i markpanelets header og dobbeltklik på række kalder `fitBounds(markens bounds, padding 64, maxZoom 16, 500 ms)` via `zoomRequest`. "Vis alle" på kortet gør det modsatte med `getFieldsBounds(fields)`.
- Regler-tilstand: klik på polygon scroller til rækken og giver den fokus, så Lås/Lås op er et tastetryk væk. `SimulationRulesPanel` ligger over listen i listeruden.
- Tilføj marker fra registret (kun afgrødehistorik): mens add mode kører, snapper fladen til Kort-yderpunktet og gendanner bredden ved Færdig/Annuller. Tilføj-kortet indsnævres til `w-72` med CVR-blokken bag en `DisclosureButton`. Den tomme listes "Åbn kortvisning" udgår; teksten henviser til Tilføj marker på kortet.

## Tabellen

- To tætheder: fuld (dagens) og kompakt. Skiftet styres af, om tabellen kan være der i fuld tæthed: listen sammenligner rudens bredde med den målte bredde, ikke med et fast tal, og sætter `data-density` på sin rod; kolonnerne bruger varianten `full:` i stedet for en container query. Celler ombryder aldrig, afgrødenavne afkortes med ellipse ved 160 px, og sorterbare overskrifter har enheden på egen linje, så rækkerne ikke bliver højere af flere kolonner. Kompakt: `px-2`, sædskifte-tern uden afgrødenavne, Afgrøde-kolonnen kun når et år er valgt, DB2 forkortet med "t.kr", statusbadge kun for skærmlæsere. Enheder og Areal beholdes altid. Vandret scroll inde i tabelcontaineren, hvis kolonner ikke kan være der.
- Udseende (efter Stitch-forslag 09-09): legende og Kolonner-knap i en værktøjslinje inde i tabelkortet, sticky header på `bg-muted` med små dæmpede overskrifter og enheden på egen linje, tal og status højrestillet med tal i `font-medium`, marknavn i `font-semibold`, rækker 40 px kompakt og 52 px fuld, 2 px kant i venstre side i statusfarven ved tæt på og over, valgt række på `bg-secondary` med primær kant, hover på `bg-muted` med grøn chevron, bund som ensfarvet `bg-muted`-bånd i `font-semibold`. Kystvandopland-striben blev ikke flyttet ind i kortet, fordi den også styrer kortet i Kort-visning.
- Rammen (efter Stitch-forslag 10-09): sidepanelet med 11 px versal-sektionstitler, visningsknapper med 12 px radius, aktivt ikon i primær, halvfede navne og nøgletal i 12 px, Ny simulering i primær grøn, bund med kant over Skjul sidepanel og brugerrækken som hvidt kort; topbaren 48 px med bedriftsnavnet halvfedt i serif, visningspillen på muted med mørk tekst og et kantet segmentkontrol, hvor det aktive valg står hvidt med primær tekst; kystvandopland-striben som en 32 px statusrække med halvfede tal; indholdet med 16 px luft; kortet som kort med samme skygge og en 44 px værktøjslinje på linje med listens; skillelinjen usynlig, indtil man holder over den. Bunden i listen er ikke låst til bunden af ruden, fordi den så ville miste kolonneflugten.
- Sticky header og footer; tabelcontaineren er den lodrette scroller.
- Rækker er en memoiseret `FieldRow` med `isHovered`/`isSelected`, så hover på 200 rækker ikke re-renderer tabellen.
- Kolonner-menuen og legenden bliver i listeruden; kystvandopland-chips flytter op i striben over den delte flade.
- Kystvandopland i tabellen (Birks punkt 4.1c, 10-09): en valgbar kolonne "Kystvandopland" med oplandets navn, sorterbar alfabetisk med marker uden opland sidst, skjult som standard. Under kolonnerne i Kolonner-menuen ligger "Grupper efter kystvandopland", som også tænder kolonnen, når grupperingen slås til, og slukker den, når den slås fra (kolonnen kan stadig styres for sig bagefter): listen sorteres først efter opland (alfabetisk, uden opland sidst) og derefter efter den valgte kolonne, og hver gruppe får en overskriftsrække på `bg-muted/50` med statusprik, navn, antal marker og areal, og udledning mod kvoten for oplandet med samme tal som chipsene. Rækkefølgen ligger i FarmInspector, så markpanelets forrige/næste følger grupperingen. Valget gemmes pr. browser (`plantperform.farmGroupByCatchment`) og gælder begge visningstyper, ikke Regler. Fremhæver man et opland med en chip, dæmpes de andre gruppers overskrifter sammen med deres rækker.

## Kortets kontroller

- Det 18 rem store "Farvelæg marker"-kort erstattes af en 36 px `MapToolbar` over canvas: Farvelæg (select), Lag (popover med "Vis afgrødenavne for {år}" og Grøn Trepart), Vis alle, og Tilføj marker (kun afgrødehistorik).
- En 24 px legendestribe i bunden af canvas viser den aktive farvelægnings bins.
- MapLibre `NavigationControl` (zoom, uden kompas) øverst til højre. Hover-popup, afgrødepiller pr. år, låsemarkører og MARS-lag er uændrede.

## Årsgennemgang

- Afgrødehistorik har også årsgennemgangen, med kalenderår 2019-2026 fra endpointet `fields/historical-yearly-summary` (Birks historiske årsoversigt fra dev, lagt ind i vores komponent under rebasen 10-09). Året fremhæver tabellens tern, Afgrøde-kolonnen og markpanelets sædskifte; kortet følger kun året i simuleringer, fordi årets tal pr. mark kun findes der.
- Altid sammenfoldelig. Sammenfoldet header (44 px) viser de otte årstal som chips i en radiogroup med samme tastatur som søjlerne, og en tal-linje for det valgte år, så man kan skifte år uden at folde søjlerne ud.
- Kompakt tæthed (søjler h-20) når viewport-højden er under 960 px. Standard sammenfoldet når viewport-højden er under 800 px.

## Uændret

FarmTopBar (bortset fra kontrollen), FarmSidebar, SimulationRulesPanel, ManualRotationEditor, RotationDetailPanel, dialoger, backend og API. Ingen nye endpoints.

## Rækkefølge (en commit pr. trin)

1. `FarmView` får 'split', `FarmSplitView`, `SplitDivider`, `useSplitLayout` med persistens, tre-valgs kontrol, list og kort side om side.
2. Kortet kontrolleret: `selectedFieldId` som prop, hover-source, `zoomRequest`, panorering kun uden for viewport, FieldStat-kortet fjernes; `changeView` og Find mark nulstiller/tvinger ikke længere.
3. Markpanelet ud af `FarmFieldsList` og ind i `FarmSplitView`: panelet over hele listeruden; tilbage, forrige/næste, Zoom til mark; Fjern mark-dialog og sædskifte-editor følger med.
4. `MapToolbar`, legendestribe, Lag-popover, `NavigationControl`, tilføj-kortet indsnævret og Kort-snap i add mode.
5. Tabellen: kompakt tæthed, sticky header/footer, `scrollIntoView` ved valg, hover-rækker, memoiseret række, dobbeltklik til zoom.
6. Kystvandopland-striben med fremhævning, årsgennemgangens sammenfoldede chips, kompakt tæthed og standard efter højde.
7. Regler-tilstandens kortklik, Escape-rækkefølge, Delt slået fra under 800 px, QA på 1366, 1440, 1536 og 1920.

## Målt resultat

Med sidepanelet i sin standardbredde og delingen på det halve (målt før standarden blev to tredjedele til listen), målt på den byggede stilart:

| Skærm | Indre bredde | Liste og kort | Tabel | Rækker foldet / udfoldet | Markpanel |
|---|---|---|---|---|---|
| 1366x768 | 1046 px | 507 / 507 | ingen vandret scroll | 8 / 4 | over listen |
| 1440x900 | 1120 px | 544 / 544 | ingen vandret scroll | 11 / 7 | over listen |
| 1536x864 | 1216 px | 592 / 592 | ingen vandret scroll | 10 / 7 | over listen |
| 1920x1080 | 1600 px | 784 / 784 | ingen vandret scroll | 15 / 11 | over listen |

Med et år valgt kommer Afgrøde-kolonnen til, og tabellen kræver 575 px. Det giver vandret scroll på 1366 og 1440, ikke på 1536 og 1920.

## Kendte risici

- Lodret plads på 1366x768: med sidebar 320 px er den indre flade 1022 x 692 px. Sammenfoldet årsgennemgang som standard og chips i headeren giver ca. 12 rækker.
- MapLibre resize under træk kan hakke på integreret grafik. Fallback: flyt først ruderne ved pointerup.
- Hover på mange rækker kræver memoiserede rækker og rAF-throttling.
- Automatisk panorering må ikke opleves som at kortet stikker af: kun når marken er uden for viewporten, aldrig automatisk zoom.
