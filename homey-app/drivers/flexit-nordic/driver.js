'use strict';

const Homey = require('homey');
const { FlexitBACnet, discover, VentilationMode } = require('../../lib/flexit-bacnet');

// Map enum string IDs to BACnet ventilation mode integers
const MODE_STRING_TO_INT = {
  stop: VentilationMode.STOP,
  away: VentilationMode.AWAY,
  home: VentilationMode.HOME,
  high: VentilationMode.HIGH,
};

class FlexitNordicDriver extends Homey.Driver {

  async onInit() {
    this.log('FlexitNordicDriver initialized');

    // --- Flow action cards ---

    this.homey.flow.getActionCard('set_ventilation_mode')
      .registerRunListener(async (args) => {
        await args.device.setVentilationMode(args.mode);
      });

    this.homey.flow.getActionCard('set_temperature')
      .registerRunListener(async (args) => {
        await args.device.setTargetTemperature(args.temperature);
      });

    this.homey.flow.getActionCard('start_fireplace')
      .registerRunListener(async (args) => {
        await args.device.startFireplace(args.minutes);
      });

    this.homey.flow.getActionCard('start_rapid_ventilation')
      .registerRunListener(async (args) => {
        await args.device.startRapidVentilation(args.minutes);
      });

    this.homey.flow.getActionCard('toggle_heater')
      .registerRunListener(async (args) => {
        await args.device.toggleHeater(args.onoff === 'on');
      });

    // --- Flow condition cards ---

    this.homey.flow.getConditionCard('is_ventilation_mode')
      .registerRunListener(async (args) => {
        return args.device.getCapabilityValue('flexit_mode') === args.mode;
      });

    this.homey.flow.getConditionCard('is_heater_on')
      .registerRunListener(async (args) => {
        return args.device.getCapabilityValue('electric_heater') === true;
      });

    this.homey.flow.getConditionCard('is_filter_polluted')
      .registerRunListener(async (args) => {
        return args.device.getCapabilityValue('alarm_filter') === true;
      });
  }

  async onPairListDevices() {
    this.log('Starting Flexit device discovery...');

    let ips = [];
    try {
      ips = await discover(3000);
    } catch (err) {
      this.error('Discovery failed:', err);
    }

    if (ips.length === 0) {
      this.log('No devices found via discovery, returning manual entry hint');
      return [];
    }

    const devices = [];
    for (const ip of ips) {
      try {
        const client = new FlexitBACnet(ip, 2);
        await client.update();
        devices.push({
          name: `Flexit ${client.model || 'Nordic'}`,
          data: { id: client.serialNumber || ip },
          settings: {
            ip_address: ip,
            device_id: 2,
            poll_interval: 30,
          },
        });
        client.destroy();
      } catch (err) {
        this.error(`Failed to read device at ${ip}:`, err);
        // Still add it with fallback info
        devices.push({
          name: `Flexit Nordic (${ip})`,
          data: { id: ip },
          settings: {
            ip_address: ip,
            device_id: 2,
            poll_interval: 30,
          },
        });
      }
    }

    return devices;
  }

}

module.exports = FlexitNordicDriver;
