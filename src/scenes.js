// -----------------------------------------------------------------------------
// Scene action (manifest `scene_actions`): `set <device> <command>` to any
// FHEM device, even one not added to Gladys (a dummy that starts a notify, a
// structure, `on-for-timer 300`). The device is typed by the scene author:
// the scene editor can only list Gladys devices.
//
// Only a `set`, to a device FHEM knows: a ";" would chain another FHEM
// command, braces would run Perl, a pattern would reach many devices. The
// commands of locks, garage doors and alarms follow the same switch as the
// devices (allow_security_commands): a scene is not a way around it.
// -----------------------------------------------------------------------------

const DEVICE = /^[A-Za-z0-9._]+$/;
const FORBIDDEN = /[;{}\n\r]/;

export function sceneActions(bridge) {
  return {
    async send_command(fields) {
      const name = String(fields.device ?? '').trim();
      if (!DEVICE.test(name)) {
        throw bridge.error('bad_device');
      }
      const command = String(fields.command ?? '').trim();
      if (command === '' || command.length > 200 || FORBIDDEN.test(command)) {
        throw bridge.error('bad_command');
      }
      if (bridge.status === 'online' && !bridge.inventory.known.has(name)) {
        throw bridge.error('not_found', name);
      }
      if (!bridge.config.allowSecurity && bridge.inventory.security.has(name)) {
        throw bridge.error('security_disabled');
      }
      bridge.logger.info(`Scene action: set ${name} ${command.slice(0, 40)}`);
      await bridge.sendCommand(name, command);
    },
  };
}

export const SCENE_ACTION_KEYS = ['send_command'];
