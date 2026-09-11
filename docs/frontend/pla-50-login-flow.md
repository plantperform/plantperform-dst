# PLA-50: Login-flow uden forvirring

Status: bygget 10-09-2026 på `feat/pla-50-login-flow` oven på PLA-55-branchen, som nummer fem i stakken efter #26, #27, #28 og #29. Kun frontend. Linear: https://linear.app/plantperform/issue/PLA-50/ui-login-og-oprettelse-roller-oversigt-og-profil

## Problem

Birk (mail 10-09, punkt 4.2): efter Opret konto stod formularen stadig med en aktiv knap og kun en lille grøn linje som forskel, så en travl landmand kunne tro, at der manglede noget, og trykke igen. Linket i mailen landede på en side, der viste selve token i et felt og bad om et klik på Bekræft, med en formular til at sende mailen igen og et login-link ved siden af. Backenden lægger allerede token i linket (`/verify-email?token=...`), så trinnet var rent frontend.

## Løsning

- **Opret konto** sender videre til `/verify-email` med adressen i router-state. Siden hedder "Tjek din e-mail", viser adressen, hvad man skal gøre, at linket virker i 24 timer, en knap "Send mailen igen" og "Tilbage til login". Ingen formular, ingen aktiv Opret-knap.
- **Linket i mailen** bekræfter af sig selv, når siden åbner: først "Bekræfter din e-mail" med spinner, så "Du er klar" med login-formularen indbygget. E-mailen er udfyldt fra `pp-sidst-oprettet` i localStorage (sat ved Opret konto i samme browser, ryddet efter første login), og fokus står i adgangskodefeltet, så et enkelt tryk på Log ind logger ind og sender til forsiden. Backenden giver ingen tokens ved bekræftelsen, så adgangskoden skal skrives; det er det tætteste på "tryk Log ind, og du er inde" uden backend-ændring. Svarer backenden 400 (brugt eller udløbet), hedder siden "Linket virker ikke længere" med et e-mail-felt og "Send ny bekræftelsesmail". Kaldet sker kun en gang pr. token, også under React StrictMode, via en ref.
- **Login** bruger den samme `LoginForm` (`components/onboarding/LoginForm.tsx`) som bekræftelsen. Svarer backenden 403 (ikke bekræftet), står der, at mailen ikke er bekræftet, og en knap sender bekræftelsesmailen igen til den indtastede adresse uden at forlade siden. 401 giver som før "E-mail eller adgangskode er forkert".
- **Kort og brandpanel** (efter Stitch-forslag 10-09): formularen ligger i et hvidt kort på 460 px med hårfin kant, blød skygge og 40 px luft, og links ligger under kortet. Felter og knapper er 44 px, adgangskoden kan vises med "Vis", og forkert login markerer begge felter med rød kant ved siden af fejlboksen. Brandpanelet har en ekstra sætning om, hvad appen gør, et svagt lysskær bag overskriften og en markmosaik, der glider over i det grønne. "Glemt adgangskode?" fra forslaget er udeladt, fordi backenden ikke har et endpoint til nulstilling.
- **Resten af flowet** (efter Stitch-forslag 11-09): rollekortene på Opret konto er lettere med en lille ikonboks, grøn kant og flueben ved valg, adgangskodefeltet har også "Vis" her, og e-mailadressen står med fed i "Tjek din e-mail" og "Du er klar". Send-igen-knappen ved ubekræftet login er 44 px og sidder lige over Log ind. Fra forslaget er låseikonet på login, "Glemt adgangskode?" og "Kontakt rådgivningen" udeladt: formularsiderne har ingen ikon, og backenden har hverken nulstilling eller en rådgivningskontakt.
- **Feltvalidering** (11-09): e-mail og adgangskode tjekkes i frontenden efter samme regler som backenden (et @ og et punktum i domænet, mindst 6 tegn). Fejlen står på dansk under feltet med rød kant, dukker op når man forlader et udfyldt felt eller trykker på knappen, forsvinder mens man retter, og fokus springer til det første felt med fejl. Browserens egne popups er slået fra. Gælder login, Opret konto og send-igen-formularen; "findes allerede" ved oprettelse står også under e-mail-feltet.
- **Udseende**: hver side har et ikon i en rund flade over titlen (`AuthIcon` i `AuthLayout.tsx`: konvolut, flueben, spinner, advarsel i rød), og indholdet glider ind med `rise-in`, så siderne ikke står tomme.
- **Uden token og uden state** viser `/verify-email` kun formularen "Send bekræftelsesmail igen", som login-sidens "Send igen"-link peger på.
- Grøn og rød besked er samlet i `AuthNotice` (`components/onboarding/AuthNotice.tsx`), så de tre sider ser ens ud.

## Backend

Ingen ændringer. Endpoints: `POST /auth/register` (202, 409 findes), `POST /auth/verify` (200, 400 ugyldigt), `POST /auth/verification/resend` (202 altid), `POST /auth/login` (403 ikke bekræftet, 401 forkert). På development-profilen logges linket i API-containeren i stedet for at blive sendt.

## Sådan testes det

1. Opret en konto med en ny adresse. Siden skifter til "Tjek din e-mail" med adressen.
2. Find linket i API-loggen (`docker logs plantperform-dev-api-1 --tail 30`), åbn det: siden bekræfter selv og viser Log ind.
3. Siden hedder "Du er klar" med e-mailen udfyldt: skriv adgangskoden, og du lander på forsiden.
4. Åbn det samme link igen: "Linket virker ikke længere" med formularen.
5. Opret endnu en konto, og prøv at logge ind uden at bekræfte: fejlen og knappen "Send bekræftelsesmailen igen".
