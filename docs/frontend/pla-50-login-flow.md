# PLA-50: Login-flow uden forvirring

Status: bygget 10-09-2026 på `feat/pla-50-login-flow` direkte oven på dev. Kun frontend. Linear: https://linear.app/plantperform/issue/PLA-50/ui-login-og-oprettelse-roller-oversigt-og-profil

## Problem

Birk (mail 10-09, punkt 4.2): efter Opret konto stod formularen stadig med en aktiv knap og kun en lille grøn linje som forskel, så en travl landmand kunne tro, at der manglede noget, og trykke igen. Linket i mailen landede på en side, der viste selve token i et felt og bad om et klik på Bekræft, med en formular til at sende mailen igen og et login-link ved siden af. Backenden lægger allerede token i linket (`/verify-email?token=...`), så trinnet var rent frontend.

## Løsning

- **Opret konto** sender videre til `/verify-email` med adressen i router-state. Siden hedder "Tjek din e-mail", viser adressen, hvad man skal gøre, at linket virker i 24 timer, en knap "Send mailen igen" og "Tilbage til login". Ingen formular, ingen aktiv Opret-knap.
- **Linket i mailen** bekræfter af sig selv, når siden åbner: først "Bekræfter din e-mail" med spinner, så "Din e-mail er bekræftet" med en Log ind-knap, der sender til login med `verified` i router-state. Svarer backenden 400 (brugt eller udløbet), hedder siden "Linket virker ikke længere" med et e-mail-felt og "Send ny bekræftelsesmail". Kaldet sker kun en gang pr. token, også under React StrictMode, via en ref.
- **Login** viser en grøn linje "Din e-mail er bekræftet. Log ind for at komme i gang", når man kommer fra bekræftelsen. Svarer backenden 403 (ikke bekræftet), står der, at mailen ikke er bekræftet, og en knap sender bekræftelsesmailen igen til den indtastede adresse uden at forlade siden. 401 giver som før "E-mail eller adgangskode er forkert".
- **Uden token og uden state** viser `/verify-email` kun formularen "Send bekræftelsesmail igen", som login-sidens "Send igen"-link peger på.
- Grøn og rød besked er samlet i `AuthNotice` (`components/onboarding/AuthNotice.tsx`), så de tre sider ser ens ud.

## Backend

Ingen ændringer. Endpoints: `POST /auth/register` (202, 409 findes), `POST /auth/verify` (200, 400 ugyldigt), `POST /auth/verification/resend` (202 altid), `POST /auth/login` (403 ikke bekræftet, 401 forkert). På development-profilen logges linket i API-containeren i stedet for at blive sendt.

## Sådan testes det

1. Opret en konto med en ny adresse. Siden skifter til "Tjek din e-mail" med adressen.
2. Find linket i API-loggen (`docker logs plantperform-dev-api-1 --tail 30`), åbn det: siden bekræfter selv og viser Log ind.
3. Klik Log ind: login-siden har den grønne linje. Log ind.
4. Åbn det samme link igen: "Linket virker ikke længere" med formularen.
5. Opret endnu en konto, og prøv at logge ind uden at bekræfte: fejlen og knappen "Send bekræftelsesmailen igen".
