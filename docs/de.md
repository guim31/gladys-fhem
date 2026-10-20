# FHEM-Brücke

Diese Integration verbindet Gladys mit deinem **FHEM**-Server. Die Geräte von
FHEM (HomeMatic, Z-Wave, Shelly, Dummies, alles, was FHEM steuert) werden zu
Gladys-Geräten: Deren Readings folgen FHEM live, und Gladys steuert sie über
FHEM, das weiter mit der Hardware spricht. Alles bleibt in deinem lokalen Netz.

FHEM ist nicht mit Gladys Assistant verbunden, und diese Integration ist nicht
mit dem FHEM-Projekt verbunden.

> Getestet mit einem echten FHEM 6.4 in Docker und Dummy-Geräten (ohne echte
> Hardware): Rückmeldungen aus echten Installationen sind willkommen.

## Voraussetzungen

- Gladys Assistant 5.1.0 oder neuer.
- FHEM mit seiner Weboberfläche **FHEMWEB** (das Gerät `WEB`, standardmäßig
  Port 8083), von der Gladys-Maschine aus erreichbar.
- Optional: Benutzername und Passwort, falls FHEMWEB danach fragt (ein
  `allowed`-Gerät mit `basicAuth`).

## Konfiguration

### Adresse

Gib die Adresse von FHEMWEB ein, wie sie die Gladys-Maschine sieht, zum
Beispiel `http://192.168.1.30:8083/fhem`. Ohne Pfad wird `/fhem` verwendet,
ohne Port 8083. Nimm eine IP-Adresse: Gladys startet die Integration in einem
Container, der keine `.local`-Namen auflöst, und `localhost` ist der Container
selbst.

Gladys liest das CSRF-Token von FHEMWEB selbst: In FHEM ist nichts zu ändern.

### Benutzername und Passwort

Lass sie leer, wenn FHEMWEB ohne Passwort öffnet. Hast du es geschützt
(`define allowed_WEB allowed`, `attr allowed_WEB validFor WEB`,
`set allowed_WEB basicAuth <Benutzer> <Passwort>`), gib dieselben ein.

### Auswahl der Geräte

- **Nur die Geräte dieser Räume**: FHEM-Räume (Attribut `room`), durch Kommas
  getrennt. Ein Gerät zählt, wenn es in einem davon liegt. Leer: alle Geräte.
- **Auszulassende Geräte**: FHEM-Gerätenamen, durch Kommas getrennt; `*` steht
  für beliebigen Text (`HM_*, Test_*`).
- In FHEM wird ein Gerät mit `genericDeviceType` `ignore` oder mit dem Attribut
  `ignore` nie importiert.

### Schlösser, Garagentore und Alarmanlagen

Standardmäßig aus: Schlösser zeigen ihren Zustand, Garagentore, ob sie offen
sind, aber Gladys kann sie nicht öffnen, weder über das Gerät noch über eine
Szene oder einen Sprachassistenten. Schalte **Befehle für Schlösser, Garagentore
und Alarmanlagen erlauben** ein, wenn du das möchtest. Ein Gerät ist ein Schloss,
ein Garagentor oder eine Alarmanlage, wenn sein `genericDeviceType` `lock`,
`garage` oder `security` ist, oder wenn es die Befehle `lock` und `unlock` hat.

### Optionen

- **Rollläden: 0 % heißt offen in FHEM**: Gladys erwartet 100 % für einen
  offenen Rollladen, wie HomeMatic, Shelly und das homebridge-Mapping in FHEM.
  Schalte es ein, wenn deine Rollläden andersherum zählen.
- **Mindestabstand zwischen zwei Werten eines Sensors**: Ein Zähler, der jede
  Sekunde meldet, wird in diesem Takt an Gladys gesendet (standardmäßig 10 s).
  Schalter und Melder werden nie verzögert.
- **Für Szenen beobachtete Geräte**: siehe den Szenen-Auslöser unten.
- **Sprache der Funktionsnamen**: standardmäßig Französisch.

## Was du bekommst

### Geräte

Jedes FHEM-Gerät wird einmal im Reiter **Entdecken** angeboten, benannt nach
seinem `alias` (sonst seinem Namen) und seinem Raum. Füge die gewünschten
hinzu. Die Art eines Geräts ergibt sich aus seinem Attribut
`genericDeviceType`, wenn es gesetzt ist, sonst aus seinen Befehlen
(`PossibleSets`) und Readings:

| FHEM                                                         | Gladys                                                        |
| ------------------------------------------------------------ | ------------------------------------------------------------- |
| `genericDeviceType` `light`, oder `on`/`off` mit `pct`/`dim` | Lampe: Ein/Aus, Helligkeit                                    |
| `genericDeviceType` `switch`/`outlet`, oder `on`/`off`       | Schalter: Ein/Aus                                             |
| `genericDeviceType` `blind`, oder `up`/`down`/`stop`         | Rollladen: Position (`pct`), Öffnen/Schließen/Stopp           |
| `desired-temp` (Thermostate)                                 | Thermostat-Sollwert, in den Grenzen, die FHEM angibt          |
| `genericDeviceType` `contact`/`window`/`garage`, `contact`   | Öffnungssensor (offen, gekippt: offen)                        |
| `genericDeviceType` `motion`, Reading `motion`               | Bewegungsmelder                                               |
| Reading `presence`, PRESENCE- und ROOMMATE-Geräte            | Anwesenheitssensor                                            |
| `genericDeviceType` `lock`, Befehle `lock`/`unlock`          | Schloss (standardmäßig nur lesend)                            |
| Readings `temperature`/`measured-temp`, `humidity`           | Temperatur (°C), Luftfeuchtigkeit (%)                         |
| Readings `pressure`, `co2`, `luminance`/`illuminance`        | Luftdruck (hPa), CO2 (ppm), Beleuchtungsstärke (lux)          |
| Readings `power`, `energy`                                   | Leistung (W), Energie (kWh): des Schalters oder eines Zählers |
| Reading `battery` (`ok`/`low` oder %), `batteryPercent`      | Batterie schwach, oder Batteriestand (%)                      |

Ein Befehl wird nur angeboten, wenn FHEM ihn in den Befehlen des Geräts
aufführt; sonst ist die Funktion nur lesend. Gladys sendet `set <Gerät> on`,
`set <Gerät> pct 40`, `set <Gerät> desired-temp 21.5`… und die folgende
Änderung des Readings ist die Rückmeldung.

### Dashboard-Widget

Das Widget **FHEM** zeigt die Verbindung, ob die Zustände live oder per Abfrage
ankommen, die FHEM-Revision, die angebotenen und hinzugefügten Geräte, und eine
Schaltfläche **Neu laden**, die die Geräteliste neu liest.

### Szenen-Auslöser

**FHEM-Gerät geändert**: Ein Reading eines beobachteten Geräts hat sich
geändert (Konfiguration, **Für Szenen beobachtete Geräte**), auch eines nicht
zu Gladys hinzugefügten Geräts: ein Taster, eine Klingel, ein Bewohnerstatus,
ein Alarmmodus. Filter: Gerät, Reading und neuer Wert (alle optional).
Variablen: Gerät, Alias, Reading, neuer Wert, vorheriger Wert.

### Szenen-Aktionen

**Befehl an ein FHEM-Gerät senden**: führt `set <Gerät> <Befehl>` auf einem
beliebigen Gerät aus, das FHEM kennt, auch einem nicht hinzugefügten: `on`,
`off`, `pct 50`, `on-for-timer 300`, eine Szene einer `LightScene`… Nur ein
`set`: Ein `;` oder geschweifte Klammern werden abgelehnt, eine Szene kann also
keinen anderen FHEM-Befehl und keinen Perl-Code ausführen. Schlösser,
Garagentore und Alarmanlagen folgen dem Sicherheitsschalter.

## Szenen-Beispiele

- Wenn die Klingel `Klingel` (beobachtet) auf `pressed` wechselt, eine
  Nachricht senden und das Flurlicht für fünf Minuten einschalten
  (`on-for-timer 300`).
- Wenn das Bewohnergerät `rgr_Residents` auf `absent` wechselt, die Rollläden
  schließen und die Thermostate absenken.
- Bei Sonnenuntergang, wenn der Bewegungsmelder im Wohnzimmer seit einer Stunde
  niemanden gesehen hat, alle Lampen des Wohnzimmers ausschalten.

## Fehlerbehebung

- **Nicht erreichbar**: Prüfe die Adresse von der Gladys-Maschine aus
  (`curl http://<Adresse>:8083/fhem?XHR=1`), und dass FHEMWEB nicht auf die
  lokale Maschine beschränkt ist (Attribut `allowfrom` von `WEB`, oder ein `WEB`
  an 127.0.0.1 gebunden).
- **Zugriff verweigert**: Benutzername und Passwort des `allowed`-Geräts.
- **Ein Gerät fehlt**: Starte **Verbindung testen** in der Konfiguration: Der
  Test listet die nicht importierten FHEM-Typen. Setze `genericDeviceType` am Gerät
  in FHEM (`attr <Gerät> genericDeviceType light`), dann **Neu laden** im Widget
  oder erneut suchen.
- **„Abfrage“ im Widget**: Ein Reverse-Proxy unterbricht die lange Anfrage von
  FHEMWEB (`inform`). Die Zustände kommen trotzdem alle 30 Sekunden an.
- **Rollläden verkehrt herum**: Schalte **Rollläden: 0 % heißt offen in FHEM**
  ein.

## Grenzen

- Ohne echte FHEM-Hardware entwickelt: getestet mit FHEM 6.4 und
  Dummy-Geräten. Rückmeldungen willkommen.
- FHEM liefert keine Einheiten: Leistung wird in W, Energie in kWh,
  Temperaturen in °C angenommen.
- Farben, Thermostat-Modi, Player und andere Befehle werden nicht zu
  Gladys-Funktionen: Die Szenen-Aktion sendet jedes `set`.
- Ein in FHEM umbenanntes Gerät behält sein Gladys-Gerät (FHEM 6 gibt jedem
  Gerät eine FUUID, die das Umbenennen übersteht); auf einem älteren FHEM ohne
  FUUID ist ein umbenanntes Gerät ein neues.
- FHEMWEB sagt nichts auf einem ruhigen Strom: Der Strom wird alle 15 Minuten
  neu geöffnet und die Liste dabei neu gelesen.

## Datenschutz

Die Integration spricht nur mit deinem FHEM-Server, in deinem Netz. Nichts geht
ins Internet. Das Passwort wird von Gladys verwahrt und nie in die Logs
geschrieben.
