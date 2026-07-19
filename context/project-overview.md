# Project Overview: Bike Log (Backend / API)

## Overview

Bike Log's backend is a REST API built with Express, TypeScript, and MongoDB (Mongoose) that powers a personal motorcycle-logging app. It lets a rider log every fuel fill-up and maintenance event for their bike(s), and derives real average fuel mileage, km-based maintenance reminders, and total spending from that log — replacing manual tracking on a bike with no built-in mileage computer. Not yet built: this is a fresh (greenfield) project, currently just boilerplate cloned from `expense-tracker-server`. It will serve a future `bikelog-client` (Expo/React Native + React Native Web), which does not exist yet either.

## Goals

1. Compute real average fuel mileage (km/l) from fuel-log entries, correctly even when the tank isn't always filled to full.
2. Track maintenance (starting with engine oil) by odometer reading, with a user-editable interval per log — not a fixed interval — and surface due/overdue reminders.
3. Track total spending on the bike (fuel + maintenance), broken down by category and by time period (monthly/yearly/lifetime).
4. Support multiple bikes per user from day one.

## Roles

Single role: `User`. No admin/instructor-style split — every user only ever sees and manages their own bikes and logs. Auth is JWT-based (register/login); there is no public, unauthenticated data.

## Core Flows

### User (rider)

1. Registers (`POST /api/auth/register`) and logs in (`POST /api/auth/login`) to receive a JWT.
2. Creates one or more `Bike`s (nickname, brand, model, registration, purchase date, fuel tank capacity, current odometer).
3. Logs fuel fill-ups (`FuelLog`): odometer reading, liters added, whether it was a full tank or partial fill, cost. Full-tank fills close a mileage period and produce an exact `MileageRecord`; partial fills accumulate until the next full fill. A live approximate rolling-average mileage is also available at any time, regardless of fill type.
4. Logs maintenance events (`MaintenanceLog`, starting with Engine Oil): odometer reading, oil type (if applicable), and the interval actually applied for that service (`intervalKmUsed`, always user-editable — never a hardcoded break-in number). This computes `nextDueOdometer` for that item.
5. Views mileage stats: exact per-tank mileage history, monthly totals, yearly per-month breakdown, and lifetime (since-purchase) totals — mirroring the monthly/yearly/lifetime pattern already used in the developer's `expense-tracker-server`/`expense-tracker-client` apps.
6. Views maintenance reminders (due/overdue/upcoming), computed live from `currentOdometer` vs. each item's `nextDueOdometer`.
7. Views a spending summary (total + category breakdown, by month/year).

## Features by Category

- **Authentication:** JWT-based register/login, single `User` role.
- **Bike management:** CRUD for a user's bikes, with `currentOdometer` denormalized onto the bike for fast reminder/mileage math.
- **Fuel & mileage:** fuel-log CRUD, full-tank-to-full-tank exact mileage computation, rolling-average fallback, monthly/yearly/lifetime mileage stats.
- **Maintenance & reminders:** maintenance-type catalog (seeded, e.g. Engine Oil, Chain Lube, Tire Change, Brake Pads, General Service, Insurance, Registration/Tax, Other), maintenance-log CRUD with per-log user-editable interval, due/overdue/upcoming reminders computed on read.
- **Spending:** aggregated spending summary across `FuelLog.totalCost` + `MaintenanceLog.cost`, by category and time period.

## In Scope (MVP)

- Auth (register/login, JWT), multi-user.
- Bike CRUD (a user can own multiple bikes).
- Fuel log entries + automatic mileage computation (exact + rolling-average fallback).
- Maintenance log entries (starting with Engine Oil) + due/overdue reminders.
- Monthly/yearly/lifetime mileage stats.
- Spending summary (total, by category, by month).

## Out of Scope (for now / Phase 2)

- General maintenance & parts catalog beyond Engine Oil (tire change, chain/sprocket, brake pads, general service, insurance/registration renewal, accessories/other) — schema supports it (`MaintenanceType`), but not all types are wired up yet.
- Push notifications for reminders (Vercel Cron + Expo push) — MVP only surfaces reminders via an in-app-computed endpoint (Tier 1); real OS push is Phase 2 (Tier 2).
- Charts (mileage trend, spend trend over time) — stats are plain totals/cards for now, no charting library chosen yet.
- No automated test suite planned yet (`yarn test` in `bikelog-server/package.json` is currently a stub that just exits with an error, inherited from the cloned boilerplate).
- No frontend exists yet (`bikelog-client` is planned as Expo + React Native Web, not started).

## Success Criteria

- A user can register, log in, add a bike, log fuel fill-ups, and see a correct mileage figure (exact when they've done a full-tank close, approximate otherwise) without needing the bike's own trip meters.
- Engine-oil (and other) maintenance reminders correctly reflect whatever interval the user actually applied at each log entry — not a hardcoded number — and correctly flag due/overdue based on `currentOdometer`.
- Monthly, yearly, and lifetime mileage/spending figures are available and structurally match the equivalent stats already working in `expense-tracker-server`/`expense-tracker-client`.
