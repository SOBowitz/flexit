'use strict';

const Homey = require('homey');
const { FlexitBACnet, VentilationMode, OperationMode } = require('../../lib/flexit-bacnet');

// Operation mode int -> Homey enum string (for display)
const OP_MODE_TO_STRING = {
  [OperationMode.OFF]: 'stop',
  [OperationMode.AWAY]: 'away',
  [OperationMode.HOME]: 'home',
  [OperationMode.HIGH]: 'high',
  [OperationMode.COOKER_HOOD]: 'cooker_hood',
  [OperationMode.FIREPLACE]: 'fireplace',
  [OperationMode.TEMPORARY_HIGH]: 'high',
};

// Homey enum string -> BACnet ventilation mode int (for normal modes)
const MODE_STRING_TO_VENT_INT = {
  stop: VentilationMode.STOP,
  away: VentilationMode.AWAY,
  home: VentilationMode.HOME,
  high: VentilationMode.HIGH,
};

class FlexitNordicDevice extends Homey.Device {

  async onInit() {
    this.log('FlexitNordicDevice initialized');

    const settings = this.getSettings();
    this._ip = settings.ip_address;
    this._deviceId = settings.device_id || 2;
    this._pollIntervalMs = (settings.poll_interval || 30) * 1000;
    this._busy = false;

    this._client = new FlexitBACnet(this._ip, this._deviceId);

    // Ensure all capabilities exist (in case device was paired before they were added)
    const requiredCaps = [
      'flexit_mode', 'target_temperature', 'measure_temperature',
      'measure_temperature.outside', 'measure_temperature.extract',
      'measure_temperature.exhaust', 'measure_humidity',
      'fan_speed_supply', 'fan_speed_exhaust',
      'fan_rpm_supply', 'fan_rpm_exhaust',
      'heat_exchanger_efficiency', 'heat_exchanger_speed',
      'measure_power', 'electric_heater', 'alarm_filter',
    ];
    for (const cap of requiredCaps) {
      if (!this.hasCapability(cap)) {
        this.log(`Adding missing capability: ${cap}`);
        await this.addCapability(cap);
      }
    }

    this.registerCapabilityListener('flexit_mode', async (value) => {
      await this.setVentilationMode(value);
    });

    this.registerCapabilityListener('target_temperature', async (value) => {
      await this.setTargetTemperature(value);
    });

    this.registerCapabilityListener('electric_heater', async (value) => {
      await this.toggleHeater(value);
    });

    await this._poll();
    this._startPolling();
  }

  _startPolling() {
    this._poller = this.homey.setInterval(async () => {
      await this._poll();
    }, this._pollIntervalMs);
  }

  _stopPolling() {
    if (this._poller) {
      this.homey.clearInterval(this._poller);
      this._poller = null;
    }
  }

  async _acquireLock() {
    const start = Date.now();
    while (this._busy) {
      if (Date.now() - start > 15000) throw new Error('BACnet lock timeout');
      await new Promise(r => this.homey.setTimeout(r, 100));
    }
    this._busy = true;
  }

  _releaseLock() {
    this._busy = false;
  }

  async _poll() {
    if (this._busy) return;
    try {
      this._busy = true;
      await this._client.update();

      // Use operation mode for display — shows fireplace/cooker/etc.
      const opModeInt = this._client.operationMode;
      const modeStr = OP_MODE_TO_STRING[opModeInt] || 'home';
      const prevMode = this.getCapabilityValue('flexit_mode');
      await this.setCapabilityValue('flexit_mode', modeStr);

      if (prevMode !== null && prevMode !== modeStr) {
        const trigger = this.homey.flow.getDeviceTriggerCard('ventilation_mode_changed');
        await trigger.trigger(this, { mode: modeStr }).catch(this.error);
      }

      await this.setCapabilityValue('target_temperature', this._client.airTempSetpointHome);
      await this.setCapabilityValue('measure_temperature', this._client.supplyAirTemperature);
      await this.setCapabilityValue('measure_temperature.outside', this._client.outsideAirTemperature);
      await this.setCapabilityValue('measure_temperature.extract', this._client.extractAirTemperature);
      await this.setCapabilityValue('measure_temperature.exhaust', this._client.exhaustAirTemperature);
      await this.setCapabilityValue('measure_humidity', this._client.extractAirHumidity);
      await this.setCapabilityValue('fan_speed_supply', this._client.supplyAirFanSpeed);
      await this.setCapabilityValue('fan_speed_exhaust', this._client.exhaustAirFanSpeed);
      await this.setCapabilityValue('fan_rpm_supply', this._client.supplyAirFanRpm);
      await this.setCapabilityValue('fan_rpm_exhaust', this._client.exhaustAirFanRpm);
      await this.setCapabilityValue('heat_exchanger_efficiency', this._client.heatExchangerEfficiency);
      await this.setCapabilityValue('heat_exchanger_speed', this._client.heatExchangerSpeed);
      await this.setCapabilityValue('measure_power', this._client.electricHeaterPower * 1000);
      await this.setCapabilityValue('electric_heater', this._client.electricHeater);

      const prevFilter = this.getCapabilityValue('alarm_filter');
      const filterPolluted = this._client.airFilterPolluted;
      await this.setCapabilityValue('alarm_filter', filterPolluted);

      if (prevFilter === false && filterPolluted === true) {
        const trigger = this.homey.flow.getDeviceTriggerCard('filter_polluted');
        await trigger.trigger(this).catch(this.error);
      }

      if (!this.getAvailable()) {
        await this.setAvailable();
      }
    } catch (err) {
      this.error('Poll failed:', err);
      await this.setUnavailable('Connection lost').catch(this.error);
    } finally {
      this._busy = false;
    }
  }

  // --- Actions ---

  async setVentilationMode(modeStr) {
    await this._acquireLock();
    try {
      this.log(`Setting mode to ${modeStr}`);

      if (modeStr === 'fireplace') {
        // Fireplace uses a special trigger mechanism
        await this._client.startFireplaceVentilation(240);
        this.log('Fireplace ventilation triggered (4 hours)');
      } else if (modeStr === 'cooker_hood') {
        // Cooker hood is a binary toggle
        await this._client.activateCookerHood();
        this.log('Cooker hood activated');
      } else {
        // Normal ventilation modes — need comfort button active
        const ventInt = MODE_STRING_TO_VENT_INT[modeStr];
        if (ventInt == null) throw new Error(`Unknown mode: ${modeStr}`);

        // Deactivate cooker hood if it was on
        if (this._client._state && this._client.cookerHoodStatus) {
          await this._client.deactivateCookerHood();
        }

        // Ensure comfort button is active
        if (this._client._state && !this._client.comfortButton) {
          this.log('Activating comfort button');
          await this._client.activateComfortButton();
        } else if (!this._client._state) {
          await this._client.update();
          if (!this._client.comfortButton) {
            this.log('Activating comfort button');
            await this._client.activateComfortButton();
          }
        }

        await this._client.setVentilationMode(ventInt);
        this.log(`Ventilation mode set to ${modeStr} (${ventInt})`);
      }

      await this.setCapabilityValue('flexit_mode', modeStr);

      const trigger = this.homey.flow.getDeviceTriggerCard('ventilation_mode_changed');
      await trigger.trigger(this, { mode: modeStr }).catch(this.error);
    } catch (err) {
      this.error('setVentilationMode failed:', err);
      throw err;
    } finally {
      this._releaseLock();
    }
  }

  async setTargetTemperature(temp) {
    await this._acquireLock();
    try {
      this.log(`Setting temperature to ${temp}`);
      await this._client.setAirTempSetpointHome(temp);
      await this.setCapabilityValue('target_temperature', temp);
    } catch (err) {
      this.error('setTargetTemperature failed:', err);
      throw err;
    } finally {
      this._releaseLock();
    }
  }

  async startFireplace(minutes) {
    await this._acquireLock();
    try {
      this.log(`Starting fireplace ventilation for ${minutes} min`);
      await this._client.startFireplaceVentilation(minutes);
    } catch (err) {
      this.error('startFireplace failed:', err);
      throw err;
    } finally {
      this._releaseLock();
    }
  }

  async startRapidVentilation(minutes) {
    await this._acquireLock();
    try {
      this.log(`Starting rapid ventilation for ${minutes} min`);
      await this._client.startRapidVentilation(minutes);
    } catch (err) {
      this.error('startRapidVentilation failed:', err);
      throw err;
    } finally {
      this._releaseLock();
    }
  }

  async toggleHeater(on) {
    await this._acquireLock();
    try {
      this.log(`Setting heater to ${on ? 'ON' : 'OFF'}`);
      if (on) {
        await this._client.enableElectricHeater();
      } else {
        await this._client.disableElectricHeater();
      }
      await this.setCapabilityValue('electric_heater', on);
    } catch (err) {
      this.error('toggleHeater failed:', err);
      throw err;
    } finally {
      this._releaseLock();
    }
  }

  // --- Lifecycle ---

  async onSettings({ oldSettings, newSettings, changedKeys }) {
    if (changedKeys.includes('ip_address') || changedKeys.includes('device_id')) {
      this._ip = newSettings.ip_address || this._ip;
      this._deviceId = newSettings.device_id || this._deviceId;
      this._client.destroy();
      this._client = new FlexitBACnet(this._ip, this._deviceId);
    }
    if (changedKeys.includes('poll_interval')) {
      this._pollIntervalMs = (newSettings.poll_interval || 30) * 1000;
      this._stopPolling();
      this._startPolling();
    }
  }

  async onDeleted() {
    this.log('FlexitNordicDevice deleted');
    this._stopPolling();
    this._client.destroy();
  }

}

module.exports = FlexitNordicDevice;
