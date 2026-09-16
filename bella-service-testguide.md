# Bella Service — Testguide
**Syfte:** Verifiera att hela systemet fungerar från skapande till PDF, roll för roll.

---

## Vad du behöver
- En telefon med internet
- URL: `https://app.bellaserviceab.se/`
- Tre inloggningar (en per roll)

---

## SCENARIO 1 — Grundflödet: Skapa, Jobba, Bekräfta, PDF

### Steg 1 — ADMIN: Sätt upp systemet
**Motiv:** Verifiera att admin kan skapa ett projekt och konton.

| Gör detta | Förväntat resultat |
|---|---|
| Logga in som admin | Ser adminens startsida med +Nytt Projekt |
| Skapa ett nytt projekt med ett riktigt gatuadress | Projektet syns i Alla Projekt |
| Skapa ett arbetsledarkonto (namn + e-post) | Kontot syns i Inställningar → Konton |
| Skapa ett arbetarkonto (namn + e-post) | Kontot syns i Inställningar → Konton |

---

### Steg 2 — ARBETSLEDARE: Skapa ett pass
**Motiv:** Verifiera att ledaren kan måla dagar i kalendern och att tiers fyller passet.

| Gör detta | Förväntat resultat |
|---|---|
| Logga in som arbetsledare | Ser ledarens startsida med +Skapa Pass |
| Öppna kalendern, tryck och dra över en dag | Dagen markeras |
| Spara passet (07:00–16:00, välj projekt) | Passet syns i kalendern |
| Vänta några sekunder | Arbetaren bör vara tilldelad automatiskt via tier-systemet |

---

### Steg 3 — ARBETARE: Stämpla in och ut
**Motiv:** Verifiera att stämplingen fungerar och att geofence-kontrollen aktiveras.

| Gör detta | Förväntat resultat |
|---|---|
| Logga in som arbetare | Ser Stämpla In-knappen på startsidan |
| Tryck Stämpla In | Telefonen frågar om platsdelning — tillåt |
| Om du är mer än 4 km från projektadressen | Blockerat med felmeddelande och avstånd i km |
| Om du är inom 4 km | Stämplingen går igenom |
| Tryck Stämpla Ut senare | Samma platsvalidering, stämpling registreras |

---

### Steg 4 — ARBETSLEDARE: Bekräfta dagen
**Motiv:** Verifiera att stage 1-bekräftelse fungerar och att ledaren inte kan redigera sina egna tider.

| Gör detta | Förväntat resultat |
|---|---|
| Logga in som arbetsledare | Röd notifikationsprick på Bekräfta Pass-widgeten |
| Öppna Bekräfta Pass | Ser dagens pass med alla arbetare listade |
| Kontrollera ledarens egna rad | BÖRJAR, SLUTAR och TIMMAR ska vara låsta — ej redigerbara |
| Redigera arbetarens TIMMAR om fel | Fältet är redigerbart |
| Fyll i Vad Vi Gjorde | Obligatoriskt fält |
| Tryck Bekräfta dagen | Dagen försvinner från kön |

---

### Steg 5 — ARBETARE: Kontrollera status efter bekräftelse
**Motiv:** Verifiera invariant 10 — arbetaren ser inte timmar förrän PDF är genererad.

| Gör detta | Förväntat resultat |
|---|---|
| Logga in som arbetare | Gå till Mina Pass |
| Hitta den bekräftade dagen | Ska visa "Väntar på arbetsdagbok" — INTE timmar ännu |

---

### Steg 6 — ADMIN: Generera PDF
**Motiv:** Verifiera att Arbetsdagboken genereras och att arbetaren sedan ser sina timmar.

| Gör detta | Förväntat resultat |
|---|---|
| Logga in som admin | Hitta det bekräftade projektet |
| Generera Arbetsdagbok för datumintervallet | PDF laddas ned direkt — ingen utskriftsdialog |
| Kontrollera PDF-filnamnet | Format: DDMon-DDMon-YYYY-projektnamn.pdf |
| Öppna PDF | Vad Vi Gjorde, tider och timmar ska finnas med |

**Byt sedan till ARBETARE:**

| Gör detta | Förväntat resultat |
|---|---|
| Gå till Mina Pass | Timtalet syns nu — exakt det som stod i PDF:en |

---

## SCENARIO 2 — Avboka och ersätt

### Steg 1 — ADMIN: Avboka en arbetare
**Motiv:** Verifiera att en avbokning frigör platsen och att ersättningssystemet aktiveras.

| Gör detta | Förväntat resultat |
|---|---|
| Logga in som admin | Hitta ett pass med en tilldelad arbetare |
| Tryck Avboka på arbetarens rad | Popup: "Välj Utbyte" med lediga förval-plockare |
| Om listan är tom | Acceptera-kort visas för Tier 3 |
| Välj en ersättare | Ersättaren tilldelas, original-arbetaren notifieras |

---

## SCENARIO 3 — Öppet pass

### Motiv: Verifiera att Tier 3 Acceptera Pass fungerar.

| Roll | Gör detta | Förväntat resultat |
|---|---|---|
| ARBETARE | Logga in | Ser Acceptera Pass-kort staplade på startsidan |
| ARBETARE | Tryck Acceptera på ett kort | Platsen tilldelas på "first come first served" |
| ADMIN | Logga in och kontrollera passet | Arbetaren syns som tilldelad |

---

## SCENARIO 4 — Profil och kontoinställningar

### Motiv: Verifiera att profilen sparas korrekt och att admin kan redigera andras profiler.

| Roll | Gör detta | Förväntat resultat |
|---|---|---|
| ARBETARE | Gå till profil via ikonen uppe till höger | Ser alla fält: telefon, adress, bankkonto, anhörig |
| ARBETARE | Fyll i telefonnummer och spara | Värdet kvarstår efter omladdning |
| ARBETARE | Försök ändra namn eller e-post | Fälten är låsta |
| ADMIN | Öppna Inställningar → Konton → Ändra profil på arbetaren | Admin ser arbetarens värden |
| ADMIN | Ändra Stad, spara | Rätt rad uppdateras — adminens egen profil är orörd |

---

## Vad du ska skriva ner

Notera allt som:
- Ser trasigt ut
- Är förvirrande att navigera
- Inte fungerar på telefonskärm (för litet, fel layout, kan inte trycka)
- Beter sig annorlunda än vad du förväntade dig

Den listan blir nästa sessions arbete.
