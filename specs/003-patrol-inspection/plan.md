# Implementation Plan: Patrol Inspection

**Branch**: `003-patrol-inspection` | **Date**: 2026-07-11 | **Spec**: [spec.md](spec.md)

## Summary

Extend the existing Fastify/PostgreSQL platform with versioned patrol routes,
whitelist snapshots, task state, device-authenticated scheduler events,
evidence-backed plate observations and a React patrol page. Existing leases,
local gateway and TCP encoding remain unchanged.

## Technical Context

- TypeScript, Fastify, PostgreSQL/PostGIS, React/Vite and Vitest.
- A second SQL migration adds patrol tables without modifying existing data.
- Vehicle-side ROS components use JSON HTTPS polling/events with the existing
  device credential; GPS remains on the existing telemetry endpoint.

## Constitution Check

Pass: no TCP protocol change, browser stays outside raw vehicle-control and
tests distinguish simulated scheduler events from real-hardware validation.
