// -----------------------------------------------------------------------------
// Every text the container produces, in the four languages of the Gladys
// interface. German says "du", Spanish "usted" (test/i18n.test.js).
// FHEM and its device names are never translated.
// -----------------------------------------------------------------------------

/** Feature names, by role (src/mapping.js). */
export const ROLE_NAMES = {
  en: {
    onoff: 'On/off',
    brightness: 'Brightness',
    position: 'Position',
    shutter: 'Open/close',
    target: 'Setpoint',
    temperature: 'Temperature',
    humidity: 'Humidity',
    pressure: 'Pressure',
    co2: 'CO2',
    illuminance: 'Illuminance',
    power_meter: 'Power',
    energy: 'Energy',
    battery: 'Battery',
    battery_low: 'Low battery',
    contact: 'Opening',
    motion: 'Motion',
    presence: 'Presence',
    lock: 'Lock',
  },
  fr: {
    onoff: 'Marche/arrêt',
    brightness: 'Luminosité',
    position: 'Position',
    shutter: 'Ouvrir/fermer',
    target: 'Consigne',
    temperature: 'Température',
    humidity: 'Humidité',
    pressure: 'Pression',
    co2: 'CO2',
    illuminance: 'Éclairement',
    power_meter: 'Puissance',
    energy: 'Énergie',
    battery: 'Batterie',
    battery_low: 'Batterie faible',
    contact: 'Ouverture',
    motion: 'Mouvement',
    presence: 'Présence',
    lock: 'Serrure',
  },
  de: {
    onoff: 'Ein/Aus',
    brightness: 'Helligkeit',
    position: 'Position',
    shutter: 'Öffnen/Schließen',
    target: 'Sollwert',
    temperature: 'Temperatur',
    humidity: 'Luftfeuchtigkeit',
    pressure: 'Luftdruck',
    co2: 'CO2',
    illuminance: 'Beleuchtungsstärke',
    power_meter: 'Leistung',
    energy: 'Energie',
    battery: 'Batterie',
    battery_low: 'Batterie schwach',
    contact: 'Öffnung',
    motion: 'Bewegung',
    presence: 'Anwesenheit',
    lock: 'Schloss',
  },
  es: {
    onoff: 'Encendido/apagado',
    brightness: 'Brillo',
    position: 'Posición',
    shutter: 'Abrir/cerrar',
    target: 'Consigna',
    temperature: 'Temperatura',
    humidity: 'Humedad',
    pressure: 'Presión',
    co2: 'CO2',
    illuminance: 'Iluminancia',
    power_meter: 'Potencia',
    energy: 'Energía',
    battery: 'Batería',
    battery_low: 'Batería baja',
    contact: 'Apertura',
    motion: 'Movimiento',
    presence: 'Presencia',
    lock: 'Cerradura',
  },
};

/** Connection statuses (Configuration screen, widget). */
export const STATUS = {
  not_configured: {
    en: 'Type the address of FHEM.',
    fr: "Saisissez l'adresse de FHEM.",
    de: 'Gib die Adresse von FHEM ein.',
    es: 'Escriba la dirección de FHEM.',
  },
  invalid_url: {
    en: 'The address of FHEM is not valid (example: http://192.168.1.30:8083/fhem).',
    fr: "L'adresse de FHEM n'est pas valide (exemple : http://192.168.1.30:8083/fhem).",
    de: 'Die Adresse von FHEM ist ungültig (Beispiel: http://192.168.1.30:8083/fhem).',
    es: 'La dirección de FHEM no es válida (ejemplo: http://192.168.1.30:8083/fhem).',
  },
  auth_failed: {
    en: 'FHEM refused the access: check the user name and password.',
    fr: "FHEM refuse l'accès : vérifiez le nom d'utilisateur et le mot de passe.",
    de: 'FHEM verweigert den Zugriff: Prüfe Benutzername und Passwort.',
    es: 'FHEM rechaza el acceso: compruebe el usuario y la contraseña.',
  },
  unreachable: {
    en: 'FHEM is unreachable, new attempt in a moment.',
    fr: 'FHEM est injoignable, nouvel essai dans un instant.',
    de: 'FHEM ist nicht erreichbar, neuer Versuch gleich.',
    es: 'FHEM no está accesible, nuevo intento en un momento.',
  },
};

/** Errors returned to Gladys (command toasts, scene action logs). */
export const ERRORS = {
  offline: {
    en: 'FHEM is not connected.',
    fr: "FHEM n'est pas connecté.",
    de: 'FHEM ist nicht verbunden.',
    es: 'FHEM no está conectado.',
  },
  unknown_feature: {
    en: 'This feature is no longer offered by FHEM: scan again.',
    fr: "Cette fonctionnalité n'est plus proposée par FHEM : relancez une recherche.",
    de: 'Diese Funktion bietet FHEM nicht mehr an: Suche erneut.',
    es: 'FHEM ya no ofrece esta función: vuelva a buscar.',
  },
  security_disabled: {
    en: 'Commands of locks, garage doors and alarms are disabled in the configuration.',
    fr: 'Les commandes des serrures, portes de garage et alarmes sont désactivées dans la configuration.',
    de: 'Befehle für Schlösser, Garagentore und Alarmanlagen sind in der Konfiguration deaktiviert.',
    es: 'Los comandos de cerraduras, puertas de garaje y alarmas están desactivados en la configuración.',
  },
  out_of_range: {
    en: 'Value outside the limits FHEM gives for this device.',
    fr: 'Valeur hors des limites que FHEM donne pour cet appareil.',
    de: 'Wert außerhalb der Grenzen, die FHEM für dieses Gerät angibt.',
    es: 'Valor fuera de los límites que FHEM indica para este dispositivo.',
  },
  unsupported_value: {
    en: 'FHEM does not offer this command for this device.',
    fr: 'FHEM ne propose pas cette commande pour cet appareil.',
    de: 'FHEM bietet diesen Befehl für dieses Gerät nicht an.',
    es: 'FHEM no ofrece este comando para este dispositivo.',
  },
  bad_device: {
    en: 'Write the name of a FHEM device, for example Lamp_Kitchen.',
    fr: "Écrivez le nom d'un appareil FHEM, par exemple Lampe_Cuisine.",
    de: 'Schreibe den Namen eines FHEM-Geräts, zum Beispiel Lampe_Kueche.',
    es: 'Escriba el nombre de un dispositivo FHEM, por ejemplo Lampara_Cocina.',
  },
  bad_command: {
    en: 'Write the command to send, for example on, off, pct 50 or on-for-timer 60 (no ; nor braces).',
    fr: 'Écrivez la commande à envoyer, par exemple on, off, pct 50 ou on-for-timer 60 (sans ; ni accolades).',
    de: 'Schreibe den zu sendenden Befehl, zum Beispiel on, off, pct 50 oder on-for-timer 60 (ohne ; und Klammern).',
    es: 'Escriba el comando a enviar, por ejemplo on, off, pct 50 u on-for-timer 60 (sin ; ni llaves).',
  },
  not_found: {
    en: 'FHEM does not know this device: ',
    fr: 'FHEM ne connaît pas cet appareil : ',
    de: 'FHEM kennt dieses Gerät nicht: ',
    es: 'FHEM no conoce este dispositivo: ',
  },
  refused: {
    en: 'FHEM refused the command: ',
    fr: 'FHEM a refusé la commande : ',
    de: 'FHEM hat den Befehl abgelehnt: ',
    es: 'FHEM rechazó el comando: ',
  },
};

/** Words of the connection test and of the widget. */
export const WORDS = {
  en: {
    connected: 'Connected',
    unreachable: 'Unreachable',
    not_configured: 'Not configured',
    auth_failed: 'Access refused',
    connecting: 'Connecting',
    version: 'Version',
    connection: 'Connection',
    live: 'Live updates',
    live_on: 'Live',
    live_off: 'Polling',
    offered: 'Devices offered',
    added: 'Devices added',
    reload: 'Reload',
    reloaded: 'Device list read again.',
  },
  fr: {
    connected: 'Connecté',
    unreachable: 'Injoignable',
    not_configured: 'Non configuré',
    auth_failed: 'Accès refusé',
    connecting: 'Connexion',
    version: 'Version',
    connection: 'Connexion',
    live: 'Mises à jour',
    live_on: 'En direct',
    live_off: 'Interrogation',
    offered: 'Appareils proposés',
    added: 'Appareils ajoutés',
    reload: 'Relire',
    reloaded: 'Liste des appareils relue.',
  },
  de: {
    connected: 'Verbunden',
    unreachable: 'Nicht erreichbar',
    not_configured: 'Nicht konfiguriert',
    auth_failed: 'Zugriff verweigert',
    connecting: 'Verbinde',
    version: 'Version',
    connection: 'Verbindung',
    live: 'Aktualisierung',
    live_on: 'Live',
    live_off: 'Abfrage',
    offered: 'Angebotene Geräte',
    added: 'Hinzugefügte Geräte',
    reload: 'Neu laden',
    reloaded: 'Geräteliste neu gelesen.',
  },
  es: {
    connected: 'Conectado',
    unreachable: 'No accesible',
    not_configured: 'Sin configurar',
    auth_failed: 'Acceso rechazado',
    connecting: 'Conectando',
    version: 'Versión',
    connection: 'Conexión',
    live: 'Actualizaciones',
    live_on: 'En directo',
    live_off: 'Consulta periódica',
    offered: 'Dispositivos ofrecidos',
    added: 'Dispositivos añadidos',
    reload: 'Recargar',
    reloaded: 'Lista de dispositivos releída.',
  },
};

/**
 * The message of the "Test the connection" action.
 * @param {object} r { version, devices, ignored: [[type, count]] }
 */
export function testMessage({ version, devices, ignored }) {
  const fhem = version ? `FHEM ${version}` : 'FHEM';
  const list = ignored
    .slice(0, 8)
    .map(([reason, count]) => `${reason} (${count})`)
    .join(', ');
  const none = { en: 'none', fr: 'aucun', de: 'keine', es: 'ninguno' };
  const rest = (lang) => list || none[lang];
  return {
    en: `Connected to ${fhem}: ${devices} devices offered. Not imported: ${rest('en')}.`,
    fr: `Connecté à ${fhem} : ${devices} appareils proposés. Non importés : ${rest('fr')}.`,
    de: `Mit ${fhem} verbunden: ${devices} Geräte angeboten. Nicht importiert: ${rest('de')}.`,
    es: `Conectado a ${fhem}: ${devices} dispositivos ofrecidos. No importados: ${rest('es')}.`,
  };
}

/** An Error whose message is in the configured language, with the four kept for tests. */
export function localizedError(text, language, detail = '') {
  const err = new Error(`${text[language] ?? text.en}${detail}`);
  err.texts = text;
  return err;
}
