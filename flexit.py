#!/usr/bin/env python3
"""CLI for controlling a Flexit Nordic ventilation unit via BACnet."""

import argparse
import asyncio
import sys

from flexit_bacnet import FlexitBACnet
from flexit_bacnet.bacnet import discover

DEFAULT_IP = "192.168.1.128"
DEFAULT_ID = 2

VENTILATION_MODES = {1: "Stop", 2: "Away", 3: "Home", 4: "High"}
VENTILATION_MODE_NAMES = {v.lower(): k for k, v in VENTILATION_MODES.items()}

OPERATION_MODES = {
    1: "Off", 2: "Away", 3: "Home", 4: "High",
    5: "Cooker Hood", 6: "Fireplace", 7: "Temporary High",
}

# Set at runtime from args
device_ip = DEFAULT_IP
device_id = DEFAULT_ID


def connect():
    return FlexitBACnet(device_ip, device_id)


async def cmd_status(args):
    device = connect()
    await device.update()

    vent = VENTILATION_MODES.get(device.ventilation_mode, device.ventilation_mode)
    op = OPERATION_MODES.get(device.operation_mode, device.operation_mode)

    print(f"Flexit Nordic {device.model}  (SN: {device.serial_number})")
    print(f"{'='*50}")
    print()
    print(f"  Mode:            {op} (vent: {vent})")
    print(f"  Comfort button:  {'Active' if device.comfort_button else 'Inactive'}")
    print()
    print(f"  Outside:         {device.outside_air_temperature:5.1f} C")
    print(f"  Supply:          {device.supply_air_temperature:5.1f} C")
    print(f"  Extract:         {device.extract_air_temperature:5.1f} C")
    print(f"  Exhaust:         {device.exhaust_air_temperature:5.1f} C")
    print(f"  Room:            {device.room_temperature:5.1f} C")
    print(f"  Humidity:        {device.extract_air_humidity:5.1f} %")
    print()
    print(f"  Supply fan:      {device.supply_air_fan_control_signal:3d}%  ({device.supply_air_fan_rpm} RPM)")
    print(f"  Exhaust fan:     {device.exhaust_air_fan_control_signal:3d}%  ({device.exhaust_air_fan_rpm} RPM)")
    print()
    print(f"  Heat exchanger:  {device.heat_exchanger_speed}% speed, {device.heat_exchanger_efficiency}% efficiency")
    print(f"  Electric heater: {'ON' if device.electric_heater else 'OFF'} ({device.electric_heater_power:.1f} / {device.electric_heater_nominal_power:.1f} kW)")
    print()
    print(f"  Setpoint home:   {device.air_temp_setpoint_home:.1f} C")
    print(f"  Setpoint away:   {device.air_temp_setpoint_away:.1f} C")
    print()
    print(f"  Air filter:      {'POLLUTED' if device.air_filter_polluted else 'OK'} ({device.air_filter_operating_time:.0f} / {device.air_filter_exchange_interval:.0f} h)")
    print()
    if device.fireplace_ventilation_status:
        print(f"  Fireplace:       ACTIVE ({device.fireplace_ventilation_remaining_duration} min remaining)")
    if device.rapid_ventilation_remaining_duration > 0:
        print(f"  Rapid vent:      ACTIVE ({device.rapid_ventilation_remaining_duration} min remaining)")


async def cmd_mode(args):
    mode_name = args.mode.lower()
    if mode_name not in VENTILATION_MODE_NAMES:
        print(f"Unknown mode '{args.mode}'. Choose: stop, away, home, high")
        sys.exit(1)

    mode_val = VENTILATION_MODE_NAMES[mode_name]
    device = connect()
    await device.update()

    # Comfort button must be active to change ventilation mode
    if not device.comfort_button:
        print("Activating comfort button (required for mode control)...")
        await device.activate_comfort_button()

    await device.set_ventilation_mode(mode_val)
    print(f"Ventilation mode set to: {VENTILATION_MODES[mode_val]}")


async def cmd_temp(args):
    device = connect()

    if args.target == "home":
        await device.set_air_temp_setpoint_home(args.value)
        print(f"Home setpoint: {args.value:.1f} C")
    elif args.target == "away":
        await device.set_air_temp_setpoint_away(args.value)
        print(f"Away setpoint: {args.value:.1f} C")
    else:
        print("Target must be 'home' or 'away'")
        sys.exit(1)


async def cmd_fireplace(args):
    device = connect()
    await device.update()

    if args.action == "on":
        minutes = args.minutes or 30
        await device.start_fireplace_ventilation(minutes)
        print(f"Fireplace ventilation started for {minutes} min")
    elif args.action == "status":
        if device.fireplace_ventilation_status:
            print(f"Fireplace: ACTIVE ({device.fireplace_ventilation_remaining_duration} min remaining)")
        else:
            print("Fireplace: OFF")


async def cmd_rapid(args):
    device = connect()
    minutes = args.minutes or 30
    await device.start_rapid_ventilation(minutes)
    print(f"Rapid ventilation started for {minutes} min")


async def cmd_heater(args):
    device = connect()
    if args.action == "on":
        await device.enable_electric_heater()
        print("Electric heater enabled")
    elif args.action == "off":
        await device.disable_electric_heater()
        print("Electric heater disabled")
    elif args.action == "status":
        await device.update()
        state = "ON" if device.electric_heater else "OFF"
        print(f"Electric heater: {state} ({device.electric_heater_power:.1f} / {device.electric_heater_nominal_power:.1f} kW)")


async def cmd_cooker(args):
    device = connect()
    if args.action == "on":
        await device.activate_cooker_hood()
        print("Cooker hood mode activated")
    elif args.action == "off":
        await device.deactivate_cooker_hood()
        print("Cooker hood mode deactivated")
    elif args.action == "status":
        await device.update()
        print(f"Cooker hood: {'ACTIVE' if device.cooker_hood_status else 'OFF'}")


async def cmd_comfort(args):
    device = connect()
    if args.action == "on":
        await device.activate_comfort_button()
        print("Comfort button activated")
    elif args.action == "off":
        delay = args.delay or 0
        await device.deactivate_comfort_button(delay)
        if delay:
            print(f"Comfort button will deactivate in {delay} min")
        else:
            print("Comfort button deactivated")
    elif args.action == "status":
        await device.update()
        print(f"Comfort button: {'Active' if device.comfort_button else 'Inactive'}")


async def cmd_fan(args):
    device = connect()

    if args.action == "status":
        await device.update()
        print("Fan setpoints (supply / extract):")
        print(f"  Home:   {device.fan_setpoint_supply_air_home}% / {device.fan_setpoint_extract_air_home}%")
        print(f"  Away:   {device.fan_setpoint_supply_air_away}% / {device.fan_setpoint_extract_air_away}%")
        print(f"  High:   {device.fan_setpoint_supply_air_high}% / {device.fan_setpoint_extract_air_high}%")
        print(f"  Cooker: {device.fan_setpoint_supply_air_cooker}% / {device.fan_setpoint_extract_air_cooker}%")
        print(f"  Fire:   {device.fan_setpoint_supply_air_fire}% / {device.fan_setpoint_extract_air_fire}%")
        return

    # Set fan speed for a mode
    mode = args.action
    supply = args.supply
    extract = args.extract

    setters = {
        "home":   (device.set_fan_setpoint_supply_air_home,   device.set_fan_setpoint_extract_air_home),
        "away":   (device.set_fan_setpoint_supply_air_away,   device.set_fan_setpoint_extract_air_away),
        "high":   (device.set_fan_setpoint_supply_air_high,   device.set_fan_setpoint_extract_air_high),
        "cooker": (device.set_fan_setpoint_supply_air_cooker, device.set_fan_setpoint_extract_air_cooker),
        "fire":   (device.set_fan_setpoint_supply_air_fire,   device.set_fan_setpoint_extract_air_fire),
    }

    if mode not in setters:
        print(f"Unknown fan mode '{mode}'. Choose: home, away, high, cooker, fire, status")
        sys.exit(1)

    set_supply, set_extract = setters[mode]
    if supply is not None:
        await set_supply(supply)
    if extract is not None:
        await set_extract(extract)

    parts = []
    if supply is not None:
        parts.append(f"supply={supply}%")
    if extract is not None:
        parts.append(f"extract={extract}%")
    print(f"Fan {mode}: {', '.join(parts)}")


async def cmd_filter(args):
    device = connect()
    if args.action == "status":
        await device.update()
        print(f"Air filter: {'POLLUTED' if device.air_filter_polluted else 'OK'}")
        print(f"Operating time:    {device.air_filter_operating_time:.0f} h")
        print(f"Exchange interval: {device.air_filter_exchange_interval:.0f} h")
    elif args.action == "reset":
        await device.reset_air_filter_timer()
        print("Air filter timer reset")


async def cmd_discover(args):
    print("Scanning for Flexit devices...")
    devices = await discover(timeout=5.0)
    if not devices:
        print("No devices found.")
    else:
        for ip in devices:
            print(f"  {ip}")


def main():
    parser = argparse.ArgumentParser(
        prog="flexit",
        description="Control a Flexit Nordic ventilation unit via BACnet",
    )
    parser.add_argument("--ip", default=DEFAULT_IP, help=f"Device IP (default: {DEFAULT_IP})")
    parser.add_argument("--id", type=int, default=DEFAULT_ID, help=f"Device ID (default: {DEFAULT_ID})")
    sub = parser.add_subparsers(dest="command")

    # status
    sub.add_parser("status", help="Show full device status")

    # mode
    p = sub.add_parser("mode", help="Set ventilation mode")
    p.add_argument("mode", choices=["stop", "away", "home", "high"])

    # temp
    p = sub.add_parser("temp", help="Set temperature setpoint")
    p.add_argument("target", choices=["home", "away"])
    p.add_argument("value", type=float, help="Temperature in C")

    # fireplace
    p = sub.add_parser("fireplace", help="Fireplace ventilation")
    p.add_argument("action", choices=["on", "status"])
    p.add_argument("--minutes", type=int, help="Duration (default: 30)")

    # rapid
    p = sub.add_parser("rapid", help="Start rapid ventilation")
    p.add_argument("--minutes", type=int, help="Duration (default: 30)")

    # heater
    p = sub.add_parser("heater", help="Electric heater control")
    p.add_argument("action", choices=["on", "off", "status"])

    # cooker
    p = sub.add_parser("cooker", help="Cooker hood mode")
    p.add_argument("action", choices=["on", "off", "status"])

    # comfort
    p = sub.add_parser("comfort", help="Comfort button control")
    p.add_argument("action", choices=["on", "off", "status"])
    p.add_argument("--delay", type=int, help="Deactivation delay in minutes (0-600)")

    # fan
    p = sub.add_parser("fan", help="Fan speed setpoints")
    p.add_argument("action", help="Mode to set (home/away/high/cooker/fire) or 'status'")
    p.add_argument("--supply", type=int, help="Supply fan %")
    p.add_argument("--extract", type=int, help="Extract fan %")

    # filter
    p = sub.add_parser("filter", help="Air filter info/reset")
    p.add_argument("action", choices=["status", "reset"])

    # discover
    sub.add_parser("discover", help="Scan network for Flexit devices")

    args = parser.parse_args()

    if not args.command:
        parser.print_help()
        sys.exit(0)

    # Apply overrides
    global device_ip, device_id
    device_ip = args.ip
    device_id = args.id

    handler = {
        "status": cmd_status,
        "mode": cmd_mode,
        "temp": cmd_temp,
        "fireplace": cmd_fireplace,
        "rapid": cmd_rapid,
        "heater": cmd_heater,
        "cooker": cmd_cooker,
        "comfort": cmd_comfort,
        "fan": cmd_fan,
        "filter": cmd_filter,
        "discover": cmd_discover,
    }

    asyncio.run(handler[args.command](args))


if __name__ == "__main__":
    main()
