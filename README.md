# Solar Home Gateway

A **SunSpec Modbus TCP Gateway** that polls a Solplanet ASW H-S2 series inverter over HTTP CGI and re-exposes the readings as a standard Modbus TCP server following the [SunSpec Information Model](https://github.com/sunspec/models). The goal is to let Home Assistant's built-in SunSpec integration read the inverter natively — no custom component required.

Built on **NestJS + TypeScript** with [`node-modbus-serial`](https://github.com/yaacov/node-modbus-serial) for the Modbus server side.

This README is intentionally short. The full design, register map, and task breakdown live under [`openspec/`](./openspec/) and are produced by the SDD workflow.