#!/usr/bin/env python3
"""Discover Flexit ventilation units on the local network via BACnet."""

import asyncio
from flexit_bacnet import FlexitBACnet
from flexit_bacnet.bacnet import discover


VENTILATION_MODES = {1: "Stop", 2: "Away", 3: "Home", 4: "High"}
OPERATION_MODES = {
    1: "Off", 2: "Away", 3: "Home", 4: "High",
    5: "Cooker Hood", 6: "Fireplace", 7: "Temporary High",
}


async def main():
    print("Scanning for Flexit BACnet devices on the network...")
    print("(Broadcasting on UDP port 47808)\n")

    devices = await discover(timeout=5.0)

    if not devices:
        print("No Flexit devices found.")
        print("\nTroubleshooting:")
        print("  - Check that the Flexit unit is on the same network/subnet")
        print("  - Verify BACnet is enabled (Flexit Go app -> Installer -> Communication -> BACnet)")
        print("  - Ensure UDP port 47808 is not blocked by a firewall")
        print("  - Try running with: sudo python3 discover.py")
        return

    print(f"Found {len(devices)} Flexit device(s):\n")
    for ip in devices:
        print(f"  IP: {ip}")

    # Connect to each discovered device and read details
    # Default device ID is 2 for Flexit Nordic units
    for ip in devices:
        print(f"\n{'='*50}")
        print(f"Connecting to {ip} (device ID 2)...")
        print(f"{'='*50}\n")
        try:
            device = FlexitBACnet(ip, 2)
            await device.update()

            print(f"  Device Name:     {device.device_name}")
            print(f"  Serial Number:   {device.serial_number}")
            print(f"  Model:           {device.model}")

            print(f"\n  --- Temperatures ---")
            print(f"  Outside air:     {device.outside_air_temperature} C")
            print(f"  Supply air:      {device.supply_air_temperature} C")
            print(f"  Extract air:     {device.extract_air_temperature} C")
            print(f"  Exhaust air:     {device.exhaust_air_temperature} C")
            print(f"  Room temp:       {device.room_temperature} C")

            print(f"\n  --- Humidity ---")
            print(f"  Extract air:     {device.extract_air_humidity} %")

            print(f"\n  --- Ventilation ---")
            vent_mode = device.ventilation_mode
            op_mode = device.operation_mode
            print(f"  Ventilation mode:  {VENTILATION_MODES.get(vent_mode, vent_mode)}")
            print(f"  Operation mode:    {OPERATION_MODES.get(op_mode, op_mode)}")
            print(f"  Comfort button:    {'Active' if device.comfort_button else 'Inactive'}")

            print(f"\n  --- Fans ---")
            print(f"  Supply fan:        {device.supply_air_fan_control_signal}% ({device.supply_air_fan_rpm} RPM)")
            print(f"  Exhaust fan:       {device.exhaust_air_fan_control_signal}% ({device.exhaust_air_fan_rpm} RPM)")

            print(f"\n  --- Heat Exchanger ---")
            print(f"  Efficiency:        {device.heat_exchanger_efficiency}%")
            print(f"  Speed:             {device.heat_exchanger_speed}%")
            print(f"  Electric heater:   {'ON' if device.electric_heater else 'OFF'}")
            print(f"  Heater power:      {device.electric_heater_power} kW (nom: {device.electric_heater_nominal_power} kW)")

            print(f"\n  --- Air Filter ---")
            print(f"  Polluted:          {'YES' if device.air_filter_polluted else 'No'}")
            print(f"  Operating time:    {device.air_filter_operating_time} hours")
            print(f"  Exchange interval: {device.air_filter_exchange_interval} hours")

            print(f"\n  --- Setpoints ---")
            print(f"  Home temp:         {device.air_temp_setpoint_home} C")
            print(f"  Away temp:         {device.air_temp_setpoint_away} C")

            print(f"\n  --- Fan Setpoints ---")
            print(f"  Supply Home:   {device.fan_setpoint_supply_air_home}%  |  Extract Home:   {device.fan_setpoint_extract_air_home}%")
            print(f"  Supply Away:   {device.fan_setpoint_supply_air_away}%  |  Extract Away:   {device.fan_setpoint_extract_air_away}%")
            print(f"  Supply High:   {device.fan_setpoint_supply_air_high}%  |  Extract High:   {device.fan_setpoint_extract_air_high}%")
            print(f"  Supply Cooker: {device.fan_setpoint_supply_air_cooker}%  |  Extract Cooker: {device.fan_setpoint_extract_air_cooker}%")
            print(f"  Supply Fire:   {device.fan_setpoint_supply_air_fire}%  |  Extract Fire:   {device.fan_setpoint_extract_air_fire}%")

        except Exception as e:
            print(f"  Failed to read device at {ip}: {e}")
            import traceback
            traceback.print_exc()


if __name__ == "__main__":
    asyncio.run(main())
