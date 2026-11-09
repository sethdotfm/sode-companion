// Maps the runtime's status codes to Companion's, so the runtime stays free of Companion.
import { InstanceStatus } from '@companion-module/base';

const MAP = {
  connecting: InstanceStatus.Connecting,
  ok: InstanceStatus.Ok,
  'key-refused': InstanceStatus.AuthenticationFailure,
  'key-expired': InstanceStatus.AuthenticationFailure,
  'network-refused': InstanceStatus.InsufficientPermissions,
  'session-mode': InstanceStatus.BadConfig,
  'panel-not-found': InstanceStatus.BadConfig,
  'bad-config': InstanceStatus.BadConfig,
  'api-off': InstanceStatus.ConnectionFailure,
  unreachable: InstanceStatus.ConnectionFailure,
};

// undefined for a code the map lacks, so a test catches a new runtime code that has no status.
export const instanceStatusOf = (code) => MAP[code];
