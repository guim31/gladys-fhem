# Pont FHEM

Cette intégration relie Gladys à votre serveur **FHEM**. Les appareils de FHEM
(HomeMatic, Z-Wave, Shelly, dummies, tout ce que FHEM pilote) deviennent des
appareils Gladys : leurs valeurs (readings) suivent FHEM en direct, et Gladys
les pilote par FHEM, qui continue de parler au matériel. Tout reste sur votre
réseau local.

FHEM n'est pas affilié à Gladys Assistant, et cette intégration n'est pas
affiliée au projet FHEM.

> Testée contre un vrai FHEM 6.4 en Docker avec des appareils dummy (sans
> matériel réel) : vos retours sur de vraies installations sont les bienvenus.

## Prérequis

- Gladys Assistant 5.1.0 ou plus récent.
- FHEM avec son interface web **FHEMWEB** (l'appareil `WEB`, port 8083 par
  défaut), joignable depuis la machine de Gladys.
- Facultatif : un nom d'utilisateur et un mot de passe si FHEMWEB en demande
  (un appareil `allowed` avec `basicAuth`).

## Configuration

### Adresse

Saisissez l'adresse de FHEMWEB vue depuis la machine de Gladys, par exemple
`http://192.168.1.30:8083/fhem`. Sans chemin, `/fhem` est utilisé ; sans port, 8083. Utilisez une adresse IP : Gladys lance l'intégration dans un conteneur qui
ne résout pas les noms en `.local`, et `localhost` désigne le conteneur
lui-même.

Gladys lit tout seul le jeton CSRF de FHEMWEB : rien à changer dans FHEM.

### Nom d'utilisateur et mot de passe

Laissez-les vides si FHEMWEB s'ouvre sans mot de passe. Si vous l'avez protégé
(`define allowed_WEB allowed`, `attr allowed_WEB validFor WEB`,
`set allowed_WEB basicAuth <utilisateur> <mot de passe>`), saisissez les mêmes.

### Choisir ce qui est importé

- **Seulement les appareils de ces pièces** : pièces FHEM (attribut `room`),
  séparées par des virgules. Un appareil compte s'il est dans l'une d'elles.
  Vide : tous les appareils.
- **Appareils à écarter** : noms d'appareils FHEM, séparés par des virgules ;
  `*` remplace n'importe quel texte (`HM_*, Test_*`).
- Dans FHEM, un appareil dont le `genericDeviceType` vaut `ignore`, ou qui
  porte l'attribut `ignore`, n'est jamais importé.

### Serrures, portes de garage et alarmes

Désactivé par défaut : les serrures affichent leur état, les portes de garage
indiquent si elles sont ouvertes, mais Gladys ne peut pas les ouvrir, ni depuis
l'appareil, ni par une scène, ni par un assistant vocal. Activez **Autoriser
les commandes des serrures, portes de garage et alarmes** si vous l'acceptez.
Un appareil est une serrure, une porte de garage ou une alarme quand son
`genericDeviceType` vaut `lock`, `garage` ou `security`, ou quand il a les
commandes `lock` et `unlock`.

### Options

- **Volets : 0 % veut dire ouvert dans FHEM** : Gladys attend 100 % pour un
  volet ouvert, comme HomeMatic, Shelly et le mapping homebridge de FHEM.
  Activez-le si vos volets comptent dans l'autre sens.
- **Intervalle minimum entre deux valeurs d'un capteur** : un compteur qui
  publie chaque seconde est transmis à Gladys à ce rythme (10 s par défaut).
  Interrupteurs et détecteurs ne sont jamais retardés.
- **Appareils surveillés pour les scènes** : voir le déclencheur ci-dessous.
- **Langue des noms de fonctionnalités** : français par défaut.

## Ce que vous obtenez

### Appareils

Chaque appareil FHEM est proposé une fois dans l'onglet **Découverte**, nommé
d'après son `alias` (sinon son nom) et sa pièce. Ajoutez ceux que vous voulez.
Le genre d'un appareil vient de son attribut `genericDeviceType` s'il est
renseigné, sinon de ses commandes (`PossibleSets`) et de ses valeurs :

| FHEM                                                        | Gladys                                                       |
| ----------------------------------------------------------- | ------------------------------------------------------------ |
| `genericDeviceType` `light`, ou `on`/`off` avec `pct`/`dim` | lampe : marche/arrêt, luminosité                             |
| `genericDeviceType` `switch`/`outlet`, ou `on`/`off`        | interrupteur : marche/arrêt                                  |
| `genericDeviceType` `blind`, ou `up`/`down`/`stop`          | volet : position (`pct`), ouvrir/fermer/arrêter              |
| `desired-temp` (thermostats)                                | consigne de thermostat, dans les bornes données par FHEM     |
| `genericDeviceType` `contact`/`window`/`garage`, `contact`  | détecteur d'ouverture (ouvert, entrouvert : ouvert)          |
| `genericDeviceType` `motion`, valeur `motion`               | détecteur de mouvement                                       |
| valeur `presence`, appareils PRESENCE et ROOMMATE           | détecteur de présence                                        |
| `genericDeviceType` `lock`, commandes `lock`/`unlock`       | serrure (lecture seule par défaut)                           |
| valeurs `temperature`/`measured-temp`, `humidity`           | température (°C), humidité (%)                               |
| valeurs `pressure`, `co2`, `luminance`/`illuminance`        | pression (hPa), CO2 (ppm), éclairement (lux)                 |
| valeurs `power`, `energy`                                   | puissance (W), énergie (kWh) : de la prise, ou d'un compteur |
| valeur `battery` (`ok`/`low` ou %), `batteryPercent`        | batterie faible, ou niveau de batterie (%)                   |

Une commande n'est proposée que si FHEM la liste dans les commandes de
l'appareil ; sinon la fonctionnalité est en lecture seule. Gladys envoie
`set <appareil> on`, `set <appareil> pct 40`, `set <appareil> desired-temp 21.5`…
et le changement de valeur qui suit sert de retour d'état.

### Widget du tableau de bord

Le widget **FHEM** montre la connexion, si les états arrivent en direct ou par
interrogation, la révision de FHEM, les appareils proposés et ajoutés, et un
bouton **Relire** qui relit la liste des appareils.

### Déclencheurs de scène

**Appareil FHEM modifié** : une valeur d'un appareil surveillé a changé
(configuration, **Appareils surveillés pour les scènes**), même un appareil
non ajouté à Gladys : un bouton, une sonnette, un état des résidents, un mode
d'alarme. Filtres : appareil, reading et nouvelle valeur (tous facultatifs).
Variables : appareil, alias, reading, nouvelle valeur, valeur précédente.

### Actions de scène

**Envoyer une commande à un appareil FHEM** : exécute
`set <appareil> <commande>` sur n'importe quel appareil connu de FHEM, même non
ajouté à Gladys : `on`, `off`, `pct 50`, `on-for-timer 300`, une scène d'un
`LightScene`… Seulement un `set` : un `;` ou des accolades sont refusés, une
scène ne peut donc pas lancer une autre commande FHEM ni du code Perl. Les
serrures, portes de garage et alarmes suivent l'interrupteur de sécurité.

## Exemples de scènes

- Quand la sonnette `Klingel` (surveillée) passe à `pressed`, envoyer un message
  et allumer l'entrée pour cinq minutes (`on-for-timer 300`).
- Quand l'appareil des résidents `rgr_Residents` passe à `absent`, fermer les
  volets et baisser les thermostats.
- Au coucher du soleil, si le détecteur de mouvement du salon n'a vu personne
  depuis une heure, éteindre toutes les lampes du salon.

## Dépannage

- **Injoignable** : vérifiez l'adresse depuis la machine de Gladys
  (`curl http://<adresse>:8083/fhem?XHR=1`), et que FHEMWEB n'est pas limité à
  la machine locale (attribut `allowfrom` de `WEB`, ou un `WEB` lié à
  127.0.0.1).
- **Accès refusé** : le nom d'utilisateur et le mot de passe de l'appareil
  `allowed`.
- **Un appareil manque** : lancez **Tester la connexion** dans la
  configuration : elle liste les types FHEM non importés. Renseignez
  `genericDeviceType` sur l'appareil dans FHEM
  (`attr <appareil> genericDeviceType light`), puis **Relire** dans le widget ou
  relancez une recherche.
- **« Interrogation » dans le widget** : un proxy inverse coupe la requête
  longue de FHEMWEB (`inform`). Les états arrivent quand même toutes les
  30 secondes.
- **Volets à l'envers** : activez **Volets : 0 % veut dire ouvert dans FHEM**.

## Limites

- Développée sans matériel FHEM réel : testée contre FHEM 6.4 avec des
  appareils dummy. Vos retours sont les bienvenus.
- FHEM ne donne pas les unités : la puissance est prise en W, l'énergie en
  kWh, les températures en °C.
- Couleurs, modes des thermostats, lecteurs et autres commandes ne deviennent
  pas des fonctionnalités Gladys : l'action de scène envoie n'importe quel
  `set`.
- Un appareil renommé dans FHEM garde son appareil Gladys (FHEM 6 donne à
  chaque appareil un FUUID qui survit au renommage) ; sur un FHEM plus ancien
  sans FUUID, un appareil renommé est un nouvel appareil.
- FHEMWEB ne dit rien sur un flux calme : le flux est rouvert toutes les
  15 minutes, et la liste relue à ce moment-là.

## Confidentialité

L'intégration ne parle qu'à votre serveur FHEM, sur votre réseau. Rien ne part
sur Internet. Le mot de passe est gardé par Gladys et jamais écrit dans les
journaux.
