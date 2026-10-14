---
name: fredagsoversikt
description: Lager oversikten Gro sender ut hver fredag over hvem som har hytta de neste fire ukene, ferdig til å lime inn i e-post eller chat. Bruk når noen ber om fredagsoversikten, ukesoversikten, eller hvem som har hytta de neste ukene.
---

# Fredagsoversikten

Oversikten lages fra boka i `data/hytteboka.json`, den samme filen siden bruker. Ikke skriv den selv, og ikke legg til navn eller uker som ikke står i boka.

1. Kjør fra roten av prosjektet:

   ```
   node scripts/fredagsoversikt.js
   ```

   Uten dato gjelder oversikten fra uka som starter denne fredagen, eller i dag hvis det er fredag. Ber noen om oversikten for en annen dag, sender du datoen med: `node scripts/fredagsoversikt.js 2026-10-23`.

2. Gi teksten tilbake nøyaktig slik skriptet skrev den, i en kodeblokk, så den kan limes rett inn. Ikke endre ordlyden.

3. Under kodeblokken nevner du kort det Gro bør gjøre noe med, hvis noe står i oversikten:
   - en trekning som ikke er trukket ennå, med tanke på at uka nærmer seg
   - en trekning ingen har meldt seg på

Feiler skriptet fordi boka mangler, sier du det. Lag ikke en oversikt uten den.
