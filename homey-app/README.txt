Control your Flexit Nordic ventilation unit directly from Homey via BACnet/IP.

Supports all Flexit Nordic series: S2, S3, S4, CL2, CL3, CL4, and KS3 (both RER and REL variants).

Features:
- Set ventilation mode: Stop, Away, Home, High, Fireplace, Cooker Hood
- Adjust temperature setpoint
- Toggle electric heater
- Monitor temperatures: outside, supply, extract, exhaust
- Monitor extract air humidity
- Monitor fan speed (%) and RPM for supply and exhaust fans
- Monitor heat exchanger efficiency and rotor speed
- Monitor electric heater power consumption
- Air filter polluted alarm
- Flow cards for triggers, conditions, and actions
- Automatic device discovery on your local network

Setup:
1. Ensure your Flexit Nordic unit has BACnet/IP enabled (UDP port 47808)
2. Add the device in Homey — it will be discovered automatically
3. If not found, enter the IP address manually in device settings

The BACnet Device ID defaults to 2 (configurable in the Flexit Go app and in Homey device settings).
