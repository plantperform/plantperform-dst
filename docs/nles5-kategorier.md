# NLES5/NUAR — hvordan udvaskningskategorierne vælges

Dette dokument beskriver **hvad de officielle kilder siger**, at reglerne
skal være — ikke hvordan koden gør det i dag. Det er grundlaget for en
efterfølgende gennemgang af koden, kategori for kategori.

## Kilder

Alle henvisninger i dette dokument er til filer i:
`C:\Users\angj\OneDrive - SEGES Innovation PS\Skrivebord\DE VIGTIGE kvælstof rpoorter\Data - SGAV 14-09-26\`

- **PUMR 2027 kravspec** (`PUMR 2027 kravspec_skema_datastruktur_pr_10_09_2026.xlsx`,
  ark "Tabel A Udledningsberegning") — den officielle felt-for-felt
  formelspecifikation for hele udvasknings-/udledningsberegningen.
  Henvist til som "PUMR, felt A<nr>".
- **Parametre og konstanter** (`Parametre og konstanter_pr_11_09_2026.xlsx`)
  — den autoritative tabel over selve tal-værdierne (λ, η, θ, β, τ, μ, κ, ρ
  m.fl.), som PUMR-specen henviser til som "stamdataordningen 'Konstanter
  og parameterværdier'".
- **Afgrødetabel 2027** (`Afgrødetabel2027_07092026_Udkast_3_pr_10_9_2026.xlsx`,
  ark "Afgrødetabel 2027") — kilden til selve kategori-koderne (M/W/MP/WP)
  pr. afgrøde, samt "NUAR ekstrakolonne 1-4"-flagene der styrer
  undtagelsesreglerne.
- **Kvælstoffiksering for almindelige afgrøder til implementering**
  (`Kvælstoffiksering for almindelige afgrøder til implementering_pr_11_09_2026.xlsx`)
  — kilde til N-fikserings-tillæggene (F0/F1/F2/FOx).
- **DCA rapport nr. 163** (Børgesen, C.D. m.fl. 2020, *"NLES5 – An empirical
  model for predicting nitrate leaching from the root zone of agricultural
  land in Denmark"*, Aarhus Universitet), fil:
  `DCArapport Nless5.pdf` i `C:\Users\angj\OneDrive - SEGES Innovation PS\Skrivebord\DE VIGTIGE kvælstof rpoorter\`
  — den oprindelige, videnskabelige NLES5-modelbeskrivelse med præcise
  engelske kategori-definitioner (afsnit 2.4) og de kalibrerede
  parameterværdier (Tabel 3.2-3.3), som PUMR-specen implementerer.

## M — Hovedafgrøde-effekt (λma)

**Kilde:** PUMR, felt A59.

1. Slå forfrugtens (sidste års afgrøde) `NUAR ekstrakolonne 1`-flag op i
   Afgrødetabel 2027.
2. **Hvis** flaget er `1` **og** den nuværende hovedafgrøde selv har en
   værdi i sin egen kolonne `Udv.kat. Hovedafg. Undt. (M)` → brug **den**
   værdi.
3. **Ellers** → slå den nuværende hovedafgrøde op i kolonnen `Udv.kat.
   Hovedafg. (M)` og brug den værdi.
4. λma-tallet for den fundne M-kategori slås op i Parametre og konstanter
   (nøgler `M1`-`M13`).

Det er altså **forfrugten**, der afgør *om* der overhovedet skal ske en
undtagelse — men det er **den nuværende afgrødes egen** undtagelsesværdi,
der bruges, hvis den findes.

## W — Vinterplantedække-effekt (λwa)

**Kilde:** PUMR, felt A60. Et 3-trins hierarki, ikke ét opslag:

1. **Hvis** hovedafgrødens `NUAR ekstrakolonne 1 = 1` **og** det valgte
   vinterplantedække (feltet A32) er én af disse 17 faste koder: `9, 10,
   11, 13, 14, 15, 16, 17, 57, 70, 71, 72, 220, 221, 222, 223, 224` →
   kategorien er **altid W7**, uanset andre opslag.
2. **Ellers, hvis** trin 1 ikke gav W7, **og** hovedafgrødens egen
   `Udv.kat. Vint.plant.d. (W)` ≠ 0 → brug den værdi.
3. **Ellers** → slå det valgte vinterplantedækkes `Udv.kat Vint.plant.d.
   Undt. (W)` op, og brug den værdi.
4. λwa-tallet for den fundne W-kategori slås op i Parametre og konstanter
   (nøgler `W1`-`W8`).

## MP — Forfrugt-effekt (ηmp)

**Kilde:** PUMR, felt A61.

1. Slå **forforfrugtens** (afgrøden for to år siden) `NUAR ekstrakolonne 1`-
   flag op i Afgrødetabel 2027.
2. **Hvis** flaget er `1` **og** forfrugten selv har en værdi i sin egen
   kolonne `Udv.kat. Forfrugt Undt. (MP)` → brug **den** værdi.
   (Specens egen tekst skriver her ved en tilsyneladende tastefejl "Udv.kat.
   Hovedafg. Undt. (M)" som betingelse — men den efterfølgende handling
   bruger utvetydigt MP-undtagelseskolonnen, så det er den, der er lagt til
   grund her.)
3. **Ellers** → slå forfrugten op i kolonnen `Udv.kat. Forfrugt (MP)` og
   brug den værdi.
4. ηmp-tallet for den fundne MP-kategori slås op i Parametre og konstanter
   (nøgler `MP1`-`MP4`).

**Vigtig forskel fra M:** betingelsen i trin 1 kigger to år tilbage
(forforfrugten), ikke ét år tilbage (forfrugten) som for M.

## WP — Vinterplantedække efter forfrugt (ηwp)

**Kilde:** DCA rapport nr. 163 (Børgesen et al. 2020, *"NLES5 – An empirical
model for predicting nitrate leaching from the root zone of agricultural
land in Denmark"*), afsnit 2.4 og Tabel 3.3 — den oprindelige videnskabelige
NLES5-modelbeskrivelse, som PUMR-specen implementerer. Suppleret af PUMR,
felt A62 (2027-databegrænsningen) og Parametre og konstanter.

### Tidsmæssig placering (rapportens Figur 2.2)

WP er **ikke** forforfrugten. Det er vinterdækket i perioden lige efter
forfrugten og lige før den nuværende hovedafgrøde — altså **ét år
tilbage**, præcis som W, blot forskudt ét trin i sædskiftet:

```
Forrige hovedafgrøde (forfrugt) → Forrige vinterdække (WP)
   → Hovedafgrøde → Vinterdække (W, selve udvaskningsåret)
```

### De 10 kategorier (rapportens egne definitioner, s. 24-25)

- **WP1** Vintersæd — vintersæd der *ikke* følger græs/kløvergræs (se WP9/WP10)
- **WP2** Bar jord — efter en høstet afgrøde i efteråret, ingen vintersæd/raps etableret
- **WP3** Græs, kløvergræs eller lupin — forfrugten selv var græs/kløvergræs/lupin og **fortsætter** ind i det følgende år (endnu ikke pløjet)
- **WP4** Efterafgrøder
- **WP5** Frøgræs og brak
- **WP6** Roer og hamp — sildigt høstede afgrøder, der udelukker efterafgrøder
- **WP7** Bar jord efter majs eller kartofler
- **WP8** Vinterraps — sået i det forrige efterår
- **WP9** Bar jord eller vintersæd, hvor forfrugten (græs/kløvergræs) blev pløjet om **foråret**
- **WP10** Bar jord eller vintersæd, hvor forfrugten (græs/kløvergræs) blev pløjet om **efteråret** (før 1. november)

### Beregningsflow — kun ét år tilbage (N-1), intet N-2-opslag

**Trin 1** — hvad stod der i WP-vinduet (vinteren mellem forfrugt og beregningsår)?
- Vinterraps → **WP8**
- Frøgræs/brak → **WP5**
- Efterafgrøde → **WP4**
- Roer/hamp → **WP6**
- Græs/kløvergræs, der *stadig* står (ikke pløjet endnu) → **WP3**
- Bar jord eller vintersæd → gå til trin 2

**Trin 2** (kun relevant ved bar jord/vintersæd) — hvad **var forfrugten selv** (år N-1)?
- Majs eller kartofler → **WP7**
- Græs/kløvergræs, pløjet om **foråret** → **WP9**
- Græs/kløvergræs, pløjet om **efteråret** (før 1. nov.) → **WP10**
- Andet → direkte aflæsning fra trin 1: bar jord → **WP2**, vintersæd → **WP1**

Bemærk: det er **MP**, der kigger to år tilbage (forforfrugten) — ikke WP.
WP9/WP10's "ompløjning" refererer til forfrugtens egen afslutning, ikke en
tidligere begivenhed.

### ηwp-parameterværdier (Tabel 3.3, s. 41)

| Kategori | ηwp | SE |
| --- | --- | --- |
| WP1 (reference) | 0 | — |
| WP2 | 9,704 | 2,864 |
| WP3 | 10,601 | 3,447 |
| WP4 | 9,354 | 2,902 |
| WP5 | 13,241 | 5,101 |
| WP6 | 5,483 | 3,094 |
| WP7 | -1,572 | 2,963 |
| WP8 | 7,413 | 0,000 |
| WP9 | 7,396 | 7,976 |
| WP10 | 10,975 | 9,318 |

Disse tal stammer fra selve NLES5-kalibreringen — samme kilde som de
allerede bekræftede `M_p`- og `W_p`-tabeller i `engine.py` (og de matcher
dem: fx W7=-1,049 og M11=19,524 er identiske med det, der allerede står i
koden). De er **ikke** det samme som den flade 2027-konstant på 7,2595
(se nedenfor) — modellen har et fuldt kategorisystem, konstanten er en
administrativ nødløsning for netop 2027.

### 2027-databegrænsningen (uændret konklusion, nu i rette kontekst)

PUMR, felt A62, forklarer at oplysningen "hvilket vinterplantedække lå der
i forfrugtens efterår" ikke findes i nogen dansk indberetning før 2028.
Modellen selv **har** altså et fuldt kategorisystem med rigtige
ηwp-værdier (ovenfor) — det er **data til opslaget**, der mangler for 2027,
ikke en mangel i selve NLES5-definitionen af WP. Derfor bruges i stedet én
fast konstant (7,2595) for alle afgrøder, kun for 2027:

> "Vinterplantedække efter forfrugt er ikke en oplysning der findes i nogen
> indberetninger før i 2028. [...] **Udvikling til næste år:** Der vil blive
> opsat en kolonne i afgrødetabellen til at angive de forskellige
> udvaskningskategorier. Men der vil ikke kunne laves et korrekt opslag, pga.
> den manglende afgrødekode. Der kan også fremstilles en værdiliste i
> stamdatatabellen, men vi kan vælge at vente til næste implementering?"

Planen for 2028 og frem er stadig eksplicit uafklaret i selve PUMR-teksten
(spørgsmålstegnet i "...vi kan vælge at vente til næste implementering?").

> Brugerens forbehold (2026-09-24): 2027-fastværdien "kan muligvis stadig
> blive lavet om" — skal behandles som en årstals-betinget regel, ikke en
> permanent erstatning af det rigtige kategori-opslag ovenfor.

### Opdatering 2026-09-25 — reelle per-afgrødekode WP-værdier (trin 1)

Brugeren har leveret en tabel med WP-kategorier for **133 af de 362
afgrødekoder** — og den stemmer nu fuldstændig overens med trin 1 ovenfor:
den klassificerer, hvilken WP-kategori hver afgrøde repræsenterer, **hvis
den optræder i WP-vinduet** (fx kode 9 Vinterspelt → WP1 vintersæd, kode
101 Rajgræsfrø → WP5 frøgræs, kode 591 Lavskov → WP3, kode 950-954
efterafgrøde-koder → WP4). Det er altså den statiske del af trin 1 — ikke
trin 2's forfrugt-ompløjningslogik, som kræver sædskifte-data i stedet for
en fast tabel.

Værdierne er lagt ind i `nuar_wp`-kolonnen i masterarket
(`Afgroedetabel2027_master.csv`) og genindlæst i databasen (`nuar_kode.wp`)
**i stedet for** WP11-placeholderen, for netop disse 133 koder. De
resterende 229 koder står fortsat på WP11 (uændret placeholder — ingen
kilde har endnu givet en værdi for dem).

### Hvordan vælger koden WP i dag (uafhængigt af kilderne ovenfor)

Dette er ikke hentet fra en kilde, men en beskrivelse af den faktiske kode,
som en del af den efterfølgende kode-gennemgang — kun for WP, efter aftale.

Aftalt med brugeren 2026-10-02. `bridge_v2.py`s `_resolve_wp` går
igennem fire trin og bruger det første, der giver en kategori:

1. **Sekundær afgrøde året før** (`prev_udlaeg_kode`) → dens WP fra
   afgrødetabellen. Har tabellen ingen WP1-10 for koden (lookupens egne
   markører 2000/9680/9682/9684, og 960-966 der står på WP11), bruges
   `_UDL_WP_MAPPING`. 9683 "Tidlig såning" giver ingen WP og går videre.
2. **Beregningsårets hovedafgrøde er sået om efteråret** (WP1 eller WP8 i
   tabellen) → WP1 hhv. WP8. Tabellens WP1/WP8 beskriver en afgrøde, der
   selv står i vinteren før sit eget høstår, ikke vinteren efter. Har
   afgrøden ingen WP-kategori i tabellen (WP11 eller tom, fx en database
   indlæst før WP-værdierne kom med), afgør dens M i stedet: M1 → WP1,
   M9 → WP8.
3. **Hovedafgrøden året før står hen over vinteren** (WP3, WP5 eller WP6
   i tabellen) → dens WP.
4. **Ellers har jorden været bar**: forfrugten er majs eller kartofler →
   WP7, alt andet → WP2.

Kendes forfrugten slet ikke, gives WP11, og `engine.py`s `C_func` bruger
den faste værdi 7,2595 (`WP_FALLBACK`), som den gør for enhver WP uden for
WP1-10. WP9/WP10 (græs pløjet forår/efterår) bruges ikke, da
pløjetidspunktet ikke kendes; græs som forfrugt giver WP3 via trin 3.

## Udlægskode — sekundær afgrøde og pseudo-koder (2026-09-28)

`udlaeg_kode` (sekundær afgrøde på samme position som hovedafgrøden,
`RotationYear.udlaeg_kode`) bruges af både `_resolve_w` (W trin, denne
positions egen udlæg) og `_resolve_wp` (WP trin 1, forrige positions
udlæg). Feltet indeholder i dag en blanding af **rigtige** Afgrødetabel-
koder og **6 syntetiske virkemiddel-markører**, portet fra det gamle
`streamlit_app.py`, som ikke findes i Afgrødetabellen:

| Kode | Betydning | Status |
| --- | --- | --- |
| `3000` | Jordbearbejdning efterår | **Konverteret** til rigtig kode `921` Bar jord i kildefilen (`Ny_sædskifte_lookup_sammenlagt.csv`) — bekræftet 1:1, ingen tvetydighed |
| `9682`/`9684` | Mellemafgrøde (evt. "e. frøgræs") | Bevidst **ikke** konverteret — dækker mange forskellige rigtige hovedafgrøder (`ME - mellemafgroeder`-flaget, 173 koder), ingen enkelt rigtig kode kan substituere uden at opfinde data |
| `9683` | Tidlig såning | Samme begrundelse — `ME - tidlig saaning`, 220 koder |
| `9680` | Efterafgrøde e. frøgræs | Samme begrundelse |
| `2000` | Udlæg til frø | Samme begrundelse (`N_udlaeg`-flaget, 74 koder) |
| `0` | Intet udlæg | Triviel, ingen ændring nødvendig |

De 5 tilbageværende markører er allerede anerkendt af koden selv som deres
egen kategori (`bridge_v2.py`s `_MELLEMAFGROEDE_UDLAEG_KODER`,
`_TIDLIG_SAANING_UDLAEG_KODER`), med scenarie-niveau til/fra-knapper — de
er altså ikke fejlagtige i praksis, blot et andet kode-navnerum end
Afgrødetabellens rigtige afgrødekoder. At tvinge dem om til en rigtig
afgrødekode ville betyde at gætte en afgrøde, der ikke er registreret
nogen steder i kilden (brugerens beslutning, 2026-09-28).

**Kendte, ikke-håndhævede regler (opfølgning, udestår):** PUMR, Tabel A
Udledningsberegning, felt A32 "Vinterplantedække" og A77 "Virkemiddel" —
vores `/udlaeg-koder`-endpoint tilbyder i dag en flad liste uden nogen af
disse betingede indsnævringer:

- **Bar jord (921) kun for økologer**: *"Skemavalidering: Kun økologer må
  have lov til at vælge afgrødekoden for Bar jord kode 921. Feltet er
  obligatorisk at udfylde."* Endpointet tilbyder i dag `921` til alle
  driftsformer.
- **Efterafgrøde-undertypen indsnævres, når A77 "Virkemiddel" = "Efterafgrøder"**
  (0): kun disse 6 rigtige koder må vælges: `950, 951, 952, 968, 953, 954`
  ("Efterafgrøde type"). Yderligere indsnævring inden for de 6:
  - Majs som hovedafgrøde (`5, 19, 216, 218, 423, 425` — samme liste som
    `_FMAJS_HOVEDAFGRODE_KODER`): kun `953`/`954` må vælges.
  - Hovedafgrøde med `Grund6Procent = 1` i Afgrødetabellen: alle 6 koder må
    vælges.
  - Hovedafgrøde med `Grund6Procent = 0`: kun `950, 951, 952, 968` må
    vælges (ikke `953`/`954`).
- **Nulstillingsregel**: *"Hvis der allerede var valgt 954 eller 953 når
  hovedafgrøde ændres til andet end korn/majs skal data i feltet være tomt
  igen"* — skifter brugeren hovedafgrøde væk fra korn/majs, og der tidligere
  var valgt `953`/`954` som efterafgrøde-type, skal feltet ryddes
  automatisk.
- Uden for "Efterafgrøder"-virkemidlet (dvs. Ingen/Mellemafgrøder/Tidlig
  såning) er A32 tilsyneladende ikke underlagt denne indsnævring — det
  forklarer nok, hvorfor bredere koder som 943-946/960-966/970
  (kløvergræs-udlæg) også er gyldige data i kilden uden for
  efterafgrøde-virkemidlet.

(Den automatiske såfrist-udfyldning — "20. august", eller "05. oktober" for
majs, når `953`/`954` vælges — er bevidst **ikke** taget med her endnu;
venter til senere.)

Samme felter afklarer også `EEA`/`EMA`/`ETS`-navngivningen i
`bridge_v2.py`: PUMR felt A77 "Virkemiddel" har det officielle 3-vejs-valg
`0 = Efterafgrøder (EEA), 1 = Mellemafgrøder (EMA), 2 = Tidlig såning
(ETS)`.

A82 FOx er krydstjekket mod samme kilde og **bekræftet korrekt** som den
allerede er: *"Hvis afgrødekode i felt A32 (Vinterplantedække) er lig med
afgrødekode 952 eller 953, så indsættes værdien 35."* — matcher
`bridge_v2.py`s `fox = 35.0 if udlaeg_kode in (952, 953) else 0.0` præcist,
ingen ændring nødvendig.

**Rettet fejl (2026-09-29):** `Parametre og konstanter_pr_11_09_2026.xlsx`
(`EffektUdlaegKorn = 0,45`, `EffektUdlaegMajs = 0,15`) bekræfter, at EEA
(efterafgrøde-effekten) er lavere efter majs — men koden havde `0,10` i
stedet for de korrekte `0,15`. Samtidig gjaldt reglen kun for afgrødekode
`216` (Majshelsæd) i koden, mens PUMR (Tabel A, felt A32) selv definerer
"Majs" for netop denne regel som `Praec.goedsk.eff. = 3` i Afgrødetabellen
— bekræftet at være nøjagtig samme 6 koder som `_FMAJS_HOVEDAFGRODE_KODER`
(5, 19, 216, 218, 423, 425), ikke kun 216. Begge dele rettet i
`bridge_v2.py`.

## WC — Responsfaktor (θ)

**Kilde:** PUMR, felt A42 (henviser til afgrødetabellens WC-kolonne).

Direkte opslag af hovedafgrødens `Resp.fakt. Hovedafg. (Theta)(WC1/WC2)`.
Ingen undtagelses- eller forfrugt-afhængig mekanik fundet i kilderne.
θ-værdien for WC1 er 1 (ingen effekt); for WC2 slås `theta_2` op i
Parametre og konstanter.

## Øvrige, beslægtede korrektioner (ikke selv udvaskningskategorier)

### FOx — kvælstoffiksering fra efterafgrøde

**Kilde:** PUMR, felt A82.

Hvis vinterplantedækket (felt A32) er afgrødekode **952 eller 953**
("Efterafgr. - Kvælstoffikserende" / "...som udlæg"), tillægges **35 kg
N/ha**. Indgår i N-beregningen (felt A57) som `βf0 · (F0 + FOx)` — dvs.
lagt til F0 før selve β-vægtningen, ikke et selvstændigt led.

### Fmajs — majs-efter-kløvergræs-korrektion

**Kilde:** PUMR, felt A66 + Bilag 2, tabel 1 ("Korrektionsfaktor for majs
efter kløvergræs").

Gælder **kun**, når:
- Hovedafgrøden er én af disse 6 koder: `5, 19, 216, 218, 423, 425`, **og**
- Forfrugten er én af disse 14 koder: `173, 174, 236, 237, 256, 261, 277,
  279, 285, 286, 943, 944, 945, 946`.

Når begge betingelser er opfyldt, ganges det endelige NUAR-resultat
(`NLES5_Beregnet - Virkemiddeleffekt`) med en korrektionsfaktor, slået op i
denne tabel efter **summen** af tilført mineralsk N om foråret, efteråret
og fra udegående dyr (felterne A25+A26+A31 — ikke forårsdelen alene):

| Mineralsk N i alt (kg N/ha) | Korrektionsfaktor |
| --- | --- |
| 0-9 | 0,56 |
| 10-19 | 0,59 |
| 20-29 | 0,61 |
| 30-39 | 0,64 |
| 40-49 | 0,67 |
| 50-59 | 0,69 |
| 60-69 | 0,72 |
| 70-79 | 0,76 |
| 80-89 | 0,78 |
| 90-99 | 0,82 |
| 100-109 | 0,86 |
| 110-119 | 0,91 |
| 120-129 | 0,94 |
| 130-139 | 0,98 |
| 140-149 | 1,02 |
| 150-159 | 1,05 |
| 160-169 | 1,09 |
| 170-179 | 1,13 |
| 180-189 | 1,16 |
| 190-199 | 1,19 |
| 200+ | 1,23 |

## Status

Alle fem kategorier (M, W, MP, WP, WC) samt de to beslægtede korrektioner
(FOx, Fmajs) er dokumenteret her og gennemgået og bekræftet sammen med
brugeren (2026-09-25). WP blev undervejs rettet væsentligt efter fund af
DCA rapport nr. 163 (den oprindelige NLES5-videnskabelige kilde), som gav
de præcise kategori-definitioner og de kalibrerede ηwp-værdier. W og WC er
bevidst holdt rent PUMR-baserede uden DCA-rapportens tilføjelser, efter
aftale med brugeren. Kilde-gennemgangen er dermed færdig — næste skridt er
at holde koden op imod dette dokument, kategori for kategori.
