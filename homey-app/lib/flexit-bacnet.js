'use strict';

const bacnet = require('bacstack');
const dgram = require('dgram');
const { promisify } = require('util');

// BACnet object types
const ObjectType = {
  ANALOG_INPUT: 0,
  ANALOG_OUTPUT: 1,
  ANALOG_VALUE: 2,
  BINARY_VALUE: 5,
  DEVICE: 8,
  MULTI_STATE_VALUE: 19,
  POSITIVE_INTEGER_VALUE: 48,
};

// BACnet property identifiers
const PropertyId = {
  DESCRIPTION: 28,
  OBJECT_NAME: 77,
  PRESENT_VALUE: 85,
};

// BACnet application tags for write values
const AppTag = {
  UNSIGNED_INTEGER: 2,
  REAL: 4,
  ENUMERATED: 9,
};

// Ventilation modes
const VentilationMode = {
  STOP: 1,
  AWAY: 2,
  HOME: 3,
  HIGH: 4,
};

// Operation modes
const OperationMode = {
  OFF: 1,
  AWAY: 2,
  HOME: 3,
  HIGH: 4,
  COOKER_HOOD: 5,
  FIREPLACE: 6,
  TEMPORARY_HIGH: 7,
};

// Flexit Nordic BACnet object map — ported from flexit_bacnet/nordic.py
const Props = {
  // Comfort button (BinaryValue 50, priority 13)
  COMFORT_BUTTON:           { type: ObjectType.BINARY_VALUE, instance: 50, priority: 13 },
  COMFORT_BUTTON_DELAY:     { type: ObjectType.POSITIVE_INTEGER_VALUE, instance: 318 },

  // Modes
  OPERATION_MODE:           { type: ObjectType.MULTI_STATE_VALUE, instance: 361 },
  VENTILATION_MODE:         { type: ObjectType.MULTI_STATE_VALUE, instance: 42, priority: 13 },

  // Temperature setpoints
  AIR_TEMP_SETPOINT_AWAY:   { type: ObjectType.ANALOG_VALUE, instance: 1985 },
  AIR_TEMP_SETPOINT_HOME:   { type: ObjectType.ANALOG_VALUE, instance: 1994 },

  // Fireplace ventilation
  FIREPLACE_VENTILATION:    { type: ObjectType.MULTI_STATE_VALUE, instance: 360 },
  FIREPLACE_VENTILATION_RUNTIME: { type: ObjectType.POSITIVE_INTEGER_VALUE, instance: 270 },
  FIREPLACE_VENTILATION_REMAINING: { type: ObjectType.ANALOG_VALUE, instance: 2038 },
  FIREPLACE_STATE:          { type: ObjectType.BINARY_VALUE, instance: 400 },

  // Rapid ventilation
  RAPID_VENTILATION:        { type: ObjectType.MULTI_STATE_VALUE, instance: 357 },
  RAPID_VENTILATION_RUNTIME: { type: ObjectType.POSITIVE_INTEGER_VALUE, instance: 293 },
  RAPID_VENTILATION_REMAINING: { type: ObjectType.ANALOG_VALUE, instance: 2031 },

  // Temperatures (Analog Input)
  OUTSIDE_AIR_TEMPERATURE:  { type: ObjectType.ANALOG_INPUT, instance: 1 },
  SUPPLY_AIR_TEMPERATURE:   { type: ObjectType.ANALOG_INPUT, instance: 4 },
  EXHAUST_AIR_TEMPERATURE:  { type: ObjectType.ANALOG_INPUT, instance: 11 },
  EXTRACT_AIR_TEMPERATURE:  { type: ObjectType.ANALOG_INPUT, instance: 59 },
  EXTRACT_AIR_TEMPERATURE_ALT: { type: ObjectType.ANALOG_INPUT, instance: 95 },
  ROOM_TEMPERATURE:         { type: ObjectType.ANALOG_INPUT, instance: 75 },

  // Fan speeds (Analog Output — current control signal %)
  FAN_SPEED_SUPPLY_AIR:     { type: ObjectType.ANALOG_OUTPUT, instance: 3 },
  FAN_SPEED_EXHAUST_AIR:    { type: ObjectType.ANALOG_OUTPUT, instance: 4 },

  // Fan RPM (Analog Input)
  TACHO_SUPPLY_FAN:         { type: ObjectType.ANALOG_INPUT, instance: 5 },
  TACHO_EXHAUST_FAN:        { type: ObjectType.ANALOG_INPUT, instance: 12 },

  // Heat exchanger
  HEAT_EXCHANGER_SPEED:     { type: ObjectType.ANALOG_OUTPUT, instance: 0 },
  HEAT_EXCHANGER_EFFICIENCY: { type: ObjectType.ANALOG_VALUE, instance: 2023 },

  // Electric heater
  ELECTRICAL_HEATER:        { type: ObjectType.BINARY_VALUE, instance: 445 },
  ELECTRIC_HEATER_NOM_POWER: { type: ObjectType.ANALOG_VALUE, instance: 190 },
  HEATING_COIL_ELECTRIC_POWER: { type: ObjectType.ANALOG_VALUE, instance: 194 },

  // Cooker hood
  COOKER_HOOD:              { type: ObjectType.BINARY_VALUE, instance: 402, priority: 13 },

  // Fan setpoints (Analog Value — configurable per mode)
  FAN_SETPOINT_SUPPLY_HOME:   { type: ObjectType.ANALOG_VALUE, instance: 1836 },
  FAN_SETPOINT_SUPPLY_HIGH:   { type: ObjectType.ANALOG_VALUE, instance: 1835 },
  FAN_SETPOINT_SUPPLY_AWAY:   { type: ObjectType.ANALOG_VALUE, instance: 1837 },
  FAN_SETPOINT_SUPPLY_FIRE:   { type: ObjectType.ANALOG_VALUE, instance: 1838 },
  FAN_SETPOINT_SUPPLY_COOKER: { type: ObjectType.ANALOG_VALUE, instance: 1839 },
  FAN_SETPOINT_EXHAUST_HOME:  { type: ObjectType.ANALOG_VALUE, instance: 1841 },
  FAN_SETPOINT_EXHAUST_HIGH:  { type: ObjectType.ANALOG_VALUE, instance: 1840 },
  FAN_SETPOINT_EXHAUST_AWAY:  { type: ObjectType.ANALOG_VALUE, instance: 1842 },
  FAN_SETPOINT_EXHAUST_FIRE:  { type: ObjectType.ANALOG_VALUE, instance: 1843 },
  FAN_SETPOINT_EXHAUST_COOKER: { type: ObjectType.ANALOG_VALUE, instance: 1844 },

  // Air filter
  AIR_FILTER_OPERATING_TIME:  { type: ObjectType.ANALOG_VALUE, instance: 285 },
  AIR_FILTER_EXCHANGE_INTERVAL: { type: ObjectType.ANALOG_VALUE, instance: 286 },
  AIR_FILTER_POLLUTED:        { type: ObjectType.BINARY_VALUE, instance: 522 },
  AIR_FILTER_RESET:           { type: ObjectType.MULTI_STATE_VALUE, instance: 613 },

  // Humidity
  EXTRACT_AIR_HUMIDITY:       { type: ObjectType.ANALOG_INPUT, instance: 96 },
};

// All properties to read during update() — order matches Python DEVICE_PROPERTIES
const ALL_PROPERTIES = Object.values(Props);

// Nordic model lookup from serial prefix
const NORDIC_MODELS = {
  800110: 'S2 RER', 800111: 'S2 REL',
  800120: 'S3 RER', 800121: 'S3 REL',
  800130: 'S4 RER', 800131: 'S4 REL',
  800200: 'CL3 RER', 800201: 'CL3 REL',
  800210: 'CL2 RER', 800211: 'CL2 REL',
  800220: 'CL4 RER', 800221: 'CL4 REL',
  800300: 'KS3 RER', 800301: 'KS3 REL',
};

/**
 * Determine the correct ApplicationTag for writing to a given BACnet object type.
 */
function writeTagForType(objectType) {
  switch (objectType) {
    case ObjectType.ANALOG_VALUE:
      return AppTag.REAL;
    case ObjectType.BINARY_VALUE:
      return AppTag.ENUMERATED;
    default:
      return AppTag.UNSIGNED_INTEGER;
  }
}

/**
 * FlexitBACnet client — high-level async API for a Flexit Nordic unit.
 */
class FlexitBACnet {
  constructor(address, deviceId = 2, port = 47808) {
    this.address = address;
    this.deviceId = deviceId;
    this.port = port;
    this._state = null; // Map<string, value> keyed by "type:instance"
    this._client = null;
  }

  _getClient() {
    if (!this._client) {
      this._client = new bacnet({ apduTimeout: 6000 });
    }
    return this._client;
  }

  destroy() {
    if (this._client) {
      this._client.close();
      this._client = null;
    }
  }

  /**
   * Read all device properties + device identity in one ReadPropertyMultiple call.
   */
  async update() {
    const client = this._getClient();
    const readMultiple = promisify(client.readPropertyMultiple.bind(client));

    // Build request array: one entry per BACnet object
    const requestArray = ALL_PROPERTIES.map(p => ({
      objectId: { type: p.type, instance: p.instance },
      properties: [{ id: PropertyId.PRESENT_VALUE }],
    }));

    // Add device object for name + serial
    requestArray.push({
      objectId: { type: ObjectType.DEVICE, instance: this.deviceId },
      properties: [
        { id: PropertyId.OBJECT_NAME },
        { id: PropertyId.DESCRIPTION },
      ],
    });

    const result = await readMultiple(this.address, requestArray);

    // Parse result into a flat state map
    const state = new Map();
    for (const entry of result.values) {
      const key = `${entry.objectId.type}:${entry.objectId.instance}`;
      for (const prop of entry.values) {
        const propKey = `${key}:${prop.id}`;
        if (prop.value && prop.value.length > 0) {
          state.set(propKey, prop.value[0].value);
        }
      }
    }
    this._state = state;
  }

  _getValue(prop, propertyId = PropertyId.PRESENT_VALUE) {
    if (!this._state) throw new Error('Must call update() first');
    const key = `${prop.type}:${prop.instance}:${propertyId}`;
    return this._state.get(key);
  }

  async _writeValue(prop, value) {
    const client = this._getClient();
    const writeProp = promisify(client.writeProperty.bind(client));

    const tag = writeTagForType(prop.type);
    const options = {};
    if (prop.priority) options.priority = prop.priority;

    await writeProp(
      this.address,
      { type: prop.type, instance: prop.instance },
      PropertyId.PRESENT_VALUE,
      [{ type: tag, value }],
      options
    );
  }

  // --- Identity ---

  get deviceName() {
    const name = this._getValue(
      { type: ObjectType.DEVICE, instance: this.deviceId },
      PropertyId.OBJECT_NAME
    );
    if (name === 'HvacFnct21y_A') return 'Flexit Nordic';
    return name || '';
  }

  get serialNumber() {
    return this._getValue(
      { type: ObjectType.DEVICE, instance: this.deviceId },
      PropertyId.DESCRIPTION
    ) || '';
  }

  get model() {
    const serial = this.serialNumber;
    if (!serial || serial.length < 6) return '';
    return NORDIC_MODELS[parseInt(serial.substring(0, 6), 10)] || '';
  }

  // --- Temperatures ---

  get outsideAirTemperature() {
    return round1(this._getValue(Props.OUTSIDE_AIR_TEMPERATURE));
  }

  get supplyAirTemperature() {
    return round1(this._getValue(Props.SUPPLY_AIR_TEMPERATURE));
  }

  get exhaustAirTemperature() {
    return round1(this._getValue(Props.EXHAUST_AIR_TEMPERATURE));
  }

  get extractAirTemperature() {
    let val = round1(this._getValue(Props.EXTRACT_AIR_TEMPERATURE));
    if (!Number.isFinite(val) || val === 0) {
      val = round1(this._getValue(Props.EXTRACT_AIR_TEMPERATURE_ALT));
    }
    return val;
  }

  get roomTemperature() {
    return round1(this._getValue(Props.ROOM_TEMPERATURE));
  }

  get extractAirHumidity() {
    return round1(this._getValue(Props.EXTRACT_AIR_HUMIDITY));
  }

  // --- Modes ---

  get ventilationMode() {
    return this._getValue(Props.VENTILATION_MODE);
  }

  get operationMode() {
    return this._getValue(Props.OPERATION_MODE);
  }

  get comfortButton() {
    return this._getValue(Props.COMFORT_BUTTON) === 1;
  }

  async activateComfortButton() {
    await this._writeValue(Props.COMFORT_BUTTON, 1);
  }

  async deactivateComfortButton(delayMinutes = 0) {
    if (delayMinutes > 0) {
      await this._writeValue(Props.COMFORT_BUTTON_DELAY, delayMinutes);
    }
    await this._writeValue(Props.COMFORT_BUTTON, 0);
  }

  async setVentilationMode(mode) {
    await this._writeValue(Props.VENTILATION_MODE, mode);
  }

  // --- Temperature setpoints ---

  get airTempSetpointHome() {
    return this._getValue(Props.AIR_TEMP_SETPOINT_HOME);
  }

  async setAirTempSetpointHome(temp) {
    await this._writeValue(Props.AIR_TEMP_SETPOINT_HOME, temp);
  }

  get airTempSetpointAway() {
    return this._getValue(Props.AIR_TEMP_SETPOINT_AWAY);
  }

  async setAirTempSetpointAway(temp) {
    await this._writeValue(Props.AIR_TEMP_SETPOINT_AWAY, temp);
  }

  // --- Fireplace ---

  get fireplaceStatus() {
    return this._getValue(Props.FIREPLACE_STATE) === 1;
  }

  get fireplaceRemainingDuration() {
    return Math.round(this._getValue(Props.FIREPLACE_VENTILATION_REMAINING) || 0);
  }

  async startFireplaceVentilation(minutes = 30) {
    await this._writeValue(Props.FIREPLACE_VENTILATION_RUNTIME, minutes);
    await this._writeValue(Props.FIREPLACE_VENTILATION, 2); // trigger
  }

  // --- Rapid ventilation ---

  get rapidVentilationRemainingDuration() {
    return Math.round(this._getValue(Props.RAPID_VENTILATION_REMAINING) || 0);
  }

  async startRapidVentilation(minutes = 30) {
    await this._writeValue(Props.RAPID_VENTILATION_RUNTIME, minutes);
    await this._writeValue(Props.RAPID_VENTILATION, 2); // trigger
  }

  // --- Fans ---

  get supplyAirFanSpeed() {
    return Math.round(this._getValue(Props.FAN_SPEED_SUPPLY_AIR) || 0);
  }

  get exhaustAirFanSpeed() {
    return Math.round(this._getValue(Props.FAN_SPEED_EXHAUST_AIR) || 0);
  }

  get supplyAirFanRpm() {
    return Math.round(this._getValue(Props.TACHO_SUPPLY_FAN) || 0);
  }

  get exhaustAirFanRpm() {
    return Math.round(this._getValue(Props.TACHO_EXHAUST_FAN) || 0);
  }

  // --- Heat exchanger ---

  get heatExchangerEfficiency() {
    return Math.round(this._getValue(Props.HEAT_EXCHANGER_EFFICIENCY) || 0);
  }

  get heatExchangerSpeed() {
    return Math.round(this._getValue(Props.HEAT_EXCHANGER_SPEED) || 0);
  }

  // --- Electric heater ---

  get electricHeater() {
    return this._getValue(Props.ELECTRICAL_HEATER) === 1;
  }

  async enableElectricHeater() {
    await this._writeValue(Props.ELECTRICAL_HEATER, 1);
  }

  async disableElectricHeater() {
    await this._writeValue(Props.ELECTRICAL_HEATER, 0);
  }

  get electricHeaterPower() {
    return this._getValue(Props.HEATING_COIL_ELECTRIC_POWER) || 0;
  }

  get electricHeaterNominalPower() {
    return this._getValue(Props.ELECTRIC_HEATER_NOM_POWER) || 0;
  }

  // --- Cooker hood ---

  get cookerHoodStatus() {
    return this._getValue(Props.COOKER_HOOD) === 1;
  }

  async activateCookerHood() {
    await this._writeValue(Props.COOKER_HOOD, 1);
  }

  async deactivateCookerHood() {
    await this._writeValue(Props.COOKER_HOOD, 0);
  }

  // --- Air filter ---

  get airFilterPolluted() {
    return this._getValue(Props.AIR_FILTER_POLLUTED) === 1;
  }

  get airFilterOperatingTime() {
    return this._getValue(Props.AIR_FILTER_OPERATING_TIME) || 0;
  }

  get airFilterExchangeInterval() {
    return this._getValue(Props.AIR_FILTER_EXCHANGE_INTERVAL) || 0;
  }

  async resetAirFilterTimer() {
    await this._writeValue(Props.AIR_FILTER_RESET, 2);
  }
}

function round1(val) {
  if (val == null) return null;
  return Math.round(val * 10) / 10;
}

// --- Flexit Discovery ---
// Uses Siemens Unconfirmed Private Transfer (vendor ID 7, service 515/516)
// Ported from flexit_bacnet/bacnet.py

const BACNET_PORT = 47808;
const BVLC_TYPE = 0x81;
const BVLC_BROADCAST = 0x0B;
const NPDU_VERSION = 0x01;

// APDU type 1 = unconfirmed request, service choice 4 = unconfirmed private transfer
// Vendor ID 7 (Siemens), service number 515 (discovery)
// Service parameters captured from Flexit Go app via Wireshark
const DISCOVERY_PAYLOAD = Buffer.from([
  // BVLC header (type=0x81, function=broadcast, length filled below)
  // NPDU (version=1, control=0)
  // APDU (unconfirmed request, unconfirmed private transfer)
  0x81, 0x0b, 0x00, 0x00, // BVLC: type, broadcast, length placeholder
  0x01, 0x00,             // NPDU: version=1, control=0 (no expect reply)
  0x10, 0x04,             // APDU: unconfirmed-req, service=unconfirmedPrivateTransfer
  0x09, 0x07,             // context tag 0, length 1: vendor ID = 7 (Siemens)
  0x1a, 0x02, 0x03,       // context tag 1, length 2: service number = 515
  0x2e,                    // opening tag 2 (service parameters)
  // Fixed service parameters from Wireshark capture
  0x80, 0x01, 0x00, 0x04, 0x00, 0x00, 0x00, 0x08,
  0x64, 0x69, 0x73, 0x63, 0x6f, 0x76, 0x65, 0x72,
  0x00, 0x00, 0x00, 0x00, 0x0c, 0x00, 0x01, 0x0b,
  0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x0b, 0x00,
  0x02, 0x00, 0x00, 0x00, 0x2e, 0x41, 0x42, 0x54,
  0x4d, 0x6f, 0x62, 0x69, 0x6c, 0x65, 0x3a, 0x38,
  0x34, 0x33, 0x30, 0x33, 0x64, 0x32, 0x64, 0x2d,
  0x30, 0x34, 0x39, 0x37, 0x2d, 0x34, 0x65, 0x33,
  0x62, 0x2d, 0x62, 0x63, 0x38, 0x31, 0x2d, 0x37,
  0x65, 0x36, 0x65, 0x62, 0x62, 0x31, 0x31, 0x65,
  0x64, 0x62, 0x38, 0x0b, 0x00, 0x03, 0x00, 0x00,
  0x00, 0x0c, 0x3f, 0x44, 0x65, 0x76, 0x69, 0x63,
  0x65, 0x73, 0x3d, 0x41, 0x6c, 0x6c, 0x00, 0x00,
  0x2f,                    // closing tag 2
]);

// Patch the BVLC length field
DISCOVERY_PAYLOAD.writeUInt16BE(DISCOVERY_PAYLOAD.length, 2);

/**
 * Check if a UDP response is a Flexit discovery identification response.
 * Expects: BVLC broadcast, unconfirmed request, vendor ID 7, service 516.
 */
function isDiscoveryResponse(data) {
  if (data.length < 12) return false;
  if (data[0] !== BVLC_TYPE) return false;
  // Accept both broadcast (0x0B) and unicast (0x0A)
  if (data[1] !== 0x0B && data[1] !== 0x0A) return false;

  // NPDU starts at offset 4
  const npduVersion = data[4];
  if (npduVersion !== NPDU_VERSION) return false;

  // APDU starts at offset 6
  const apduType = data[6] >> 4;
  if (apduType !== 1) return false; // unconfirmed request

  const serviceChoice = data[7];
  if (serviceChoice !== 4) return false; // unconfirmed private transfer

  // Parse vendor ID: context tag 0, value should be 7
  if ((data[8] & 0xF8) !== 0x08) return false; // context tag 0
  const vendorId = data[9];
  if (vendorId !== 7) return false;

  // Parse service number: context tag 1, value should be 516
  if ((data[10] & 0xF8) !== 0x18) return false; // context tag 1
  const serviceLen = data[10] & 0x07;
  let serviceNumber = 0;
  for (let i = 0; i < serviceLen; i++) {
    serviceNumber = (serviceNumber << 8) | data[11 + i];
  }
  if (serviceNumber !== 516) return false;

  return true;
}

/**
 * Discover Flexit devices on the local network.
 * Returns an array of IP address strings.
 */
async function discover(timeout = 3000) {
  return new Promise((resolve) => {
    const found = new Set();
    const sock = dgram.createSocket({ type: 'udp4', reuseAddr: true });

    sock.on('message', (msg, rinfo) => {
      if (isDiscoveryResponse(msg)) {
        found.add(rinfo.address);
      }
    });

    sock.on('error', (err) => {
      // Ignore errors during discovery
    });

    sock.bind(BACNET_PORT, () => {
      sock.setBroadcast(true);

      // Send discovery requests periodically
      const sendInterval = setInterval(() => {
        sock.send(DISCOVERY_PAYLOAD, 0, DISCOVERY_PAYLOAD.length, BACNET_PORT, '255.255.255.255');
      }, 500);

      // Initial send
      sock.send(DISCOVERY_PAYLOAD, 0, DISCOVERY_PAYLOAD.length, BACNET_PORT, '255.255.255.255');

      setTimeout(() => {
        clearInterval(sendInterval);
        sock.close();
        resolve(Array.from(found));
      }, timeout);
    });
  });
}

module.exports = {
  FlexitBACnet,
  discover,
  VentilationMode,
  OperationMode,
  Props,
  NORDIC_MODELS,
};
