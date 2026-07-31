---
title: "RAIN V6 Beta — Privacy Policy"
version: "1.0.0-beta"
effective: "2026-07-31"
jurisdiction: "South Africa"
company: "ThatGuy Productions / ARCOVEL Technologies International"
license: "Proprietary"
---

# RAIN V6 Beta — Privacy Policy

**Effective Date:** 31 July 2026

**Last Updated:** 31 July 2026

## 1. Introduction

This Privacy Policy describes how **ThatGuy Productions**, operating through **ARCOVEL Technologies International** ("we," "us," "our"), handles information when you use RAIN V6 Beta ("RAIN," "the Service").

We are committed to protecting your privacy. This policy is drafted in compliance with the **Protection of Personal Information Act, 2013 (Act No. 4 of 2013) ("POPIA")** of the Republic of South Africa, as well as applicable international privacy frameworks.

### 1.1 Contact Information

- **Company:** ThatGuy Productions / ARCOVEL Technologies International
- **Responsible Party (POPIA):** ARCOVEL Technologies International
- **Email:** legal@rainv6.com
- **Jurisdiction:** Republic of South Africa

## 2. Core Principle: No PII Collection

### 2.1 The Fundamental Statement

**During the Beta phase, RAIN V6 does NOT collect, process, store, or transmit any Personally Identifiable Information (PII).**

This means we do not collect:

- **Names** — no registration, no user profiles, no artist names stored on servers
- **Email addresses** — no account creation, no newsletter signup (without separate consent)
- **IP addresses** — no server-side IP logging, no geolocation tracking
- **Physical addresses** — no billing address, no shipping address
- **Phone numbers** — no phone verification
- **Government identifiers** — no ID numbers, passport numbers, tax IDs
- **Financial information** — no credit card numbers, no bank details (Beta is R0.00)
- **Device fingerprints** — no browser fingerprinting, no canvas fingerprinting
- **Location data** — no GPS, no Wi-Fi triangulation, no coarse location
- **Biometric data** — the Artist Identity Engine (AIE) voice vector is computed and stored **entirely on your device**; it is never transmitted to our servers

### 2.2 What the Artist Identity Engine (AIE) Does

The AIE (`src/lib/rain/aie.ts`) computes a 64-dimensional voice vector from your audio for personalised mastering. This vector:

- Is computed entirely in your browser using the Web Audio API
- Is stored locally in IndexedDB (`rain-aie` database) on your device
- **Never leaves your device** — it is not uploaded to any server
- Can be exported and downloaded by you as a signed JSON file for your own records
- Can be deleted at any time via the "Reset Identity" function in the RAIN interface

## 3. What We DO Collect (Operational Data)

### 3.1 Anonymous Session Identifier

We generate a random UUIDv4 per browser (see `src/lib/rain/anon-id.ts`) and store it in your browser's `localStorage`. This identifier:

- Is a random string (e.g., `a1b2c3d4-e5f6-7890-abcd-ef1234567890`)
- Contains no PII — it cannot be linked to your identity
- Is used solely for session continuity and anonymous analytics attribution
- Can be cleared at any time by clearing your browser's `localStorage` for the RAIN domain

### 3.2 Local Processing Data (Never Leaves Your Device)

The following data is generated during use and stored exclusively in your browser:

| Data Category | Storage Location | Purpose | Server Access |
|---------------|------------------|---------|---------------|
| Audio files (uploaded) | In-memory (RAM) | Processing input | **None** — audio never leaves your device |
| Audio files (mastered) | In-memory + download | Processing output | **None** |
| Render history (last 20) | Zustand store (RAM) | Session continuity | **None** |
| Engine statistics | IndexedDB (`rain-analytics`) | Usage tracking | **None** |
| Per-render telemetry | IndexedDB (`rain-analytics`) | Performance analytics | **None** |
| QC results | IndexedDB (`rain-analytics`) | Quality tracking | **None** |
| Export records | IndexedDB (`rain-analytics`) | Export history | **None** |
| Activity log | IndexedDB (`rain-analytics`) | User action log | **None** |
| AIE voice vector | IndexedDB (`rain-aie`) | Personalised mastering | **None** |
| AIE session history | IndexedDB (`rain-aie`) | Vector EMA computation | **None** |
| Provenance keys | IndexedDB (`rain-cert-keys`) | RAIN-CERT signing | **None** |
| Macro history | Zustand store (RAM) | Undo/redo | **None** |
| Genre/preset preferences | Zustand store (RAM) | UI state | **None** |

**All data listed above is stored exclusively on your device.** None of it is transmitted to, processed by, or accessible from our servers.

### 3.3 Optional Feedback Submissions

If you choose to submit feedback through an in-app feedback mechanism (if provided), you may voluntarily include information. Any feedback submission is:

- Optional — you are never required to submit feedback
- Explicit — you control what information, if any, is included
- Minimally collected — we collect only what you choose to provide
- Used solely for product improvement

## 4. Data Processing Architecture

### 4.1 Browser-Based Processing

RAIN V6 performs **all audio processing entirely within your browser.** This architecture ensures:

- Your audio files are loaded into browser memory (RAM) using the Web Audio API
- The 16-stage DSP pipeline runs in a Web Worker
- RainNet v2 ONNX inference runs via onnxruntime-web with WebAssembly backend
- RAIN-CERT Ed25519 signing uses the Web Crypto API
- All IndexedDB/LocalStorage data stays on your device

### 4.2 No Server-Side Audio Processing

**At no point are your audio files uploaded to, processed by, or accessible from any external server.** The Service is a client-side web application that operates entirely within your browser's security sandbox.

### 4.3 What Servers Do

Our web servers serve only:

- Static application files (HTML, JavaScript, CSS, WebAssembly)
- The RainNet v2 ONNX model file (~33 MB)
- Public documentation and legal pages

Our servers do **not** receive, process, or store user audio content.

## 5. Cookie Policy

### 5.1 Cookies We Use

RAIN V6 Beta uses the following cookies:

| Cookie Name | Type | Purpose | Duration | Category |
|-------------|------|---------|----------|----------|
| Session cookie | Essential | Maintains web application state | Session (deleted on browser close) | Strictly Necessary |

### 5.2 Cookies We Do NOT Use

We do **not** use:

- Tracking cookies
- Third-party cookies
- Advertising cookies
- Analytics cookies (third-party)
- Social media cookies
- Persistent user-identifying cookies

### 5.3 Local Storage

We use `localStorage` to persist:

- Anonymous session ID (UUIDv4) — see Section 3.1
- UI preferences (theme, language)
- Last-used genre/platform selections

All `localStorage` entries are anonymous and device-local. They can be cleared at any time through your browser settings.

### 5.4 IndexedDB

We use IndexedDB databases (`rain-analytics`, `rain-aie`, `rain-cert-keys`) for local data persistence. All IndexedDB data is:

- Stored exclusively on your device
- Never synchronised with or accessible from our servers
- Clearable through your browser's "Clear site data" function
- Transparently inspectable via your browser's Developer Tools

## 6. No Third-Party Data Sharing

### 6.1 Our Commitment

**We do not sell, rent, trade, or otherwise share any data with third parties.** This commitment applies to:

- Personal information (which we do not collect)
- Anonymous usage data
- Audio content
- Processing parameters
- Analytics data

### 6.2 No Third-Party Analytics

During the Beta phase, the Service uses a custom-built, client-side-only analytics engine (`src/lib/rain/analytics.ts`). All analytics data is:

- Computed and stored locally in your browser
- Never transmitted to external analytics services (Google Analytics, Mixpanel, Amplitude, etc.)
- Completely under your control — you can clear it via the "Clear Analytics" button in the RAIN interface

### 6.3 No Advertising

The Service contains no advertising. We do not use advertising networks, ad exchanges, or any form of behavioural advertising.

### 6.4 Future Changes

If we introduce server-side analytics, user accounts, or any data sharing in the future, we will:

1. Update this Privacy Policy before implementing the change
2. Provide in-application notice
3. Require explicit consent before collecting any new category of data
4. Provide opt-out mechanisms where applicable

## 7. Data Retention

### 7.1 Server-Side Retention

We retain **no user data** on our servers because we collect **no user data**.

### 7.2 Client-Side Retention

All locally stored data (IndexedDB, localStorage) remains on your device indefinitely until you:

- Clear your browser data
- Use the "Clear Analytics" button in the RAIN interface
- Use the "Reset Identity" function in the RAIN interface
- Uninstall or reset your browser

### 7.3 Data Lifecycle

| Data Type | Retention Duration | Deletion Method |
|-----------|-------------------|-----------------|
| Audio files | Session only (RAM) | Automatic — cleared on page unload |
| Render history | Session only (RAM) | Automatic — cleared on page unload |
| Analytics (IndexedDB) | Until manually cleared | "Clear Analytics" button or browser data clear |
| AIE voice vector | Until manually cleared | "Reset Identity" function or browser data clear |
| Provenance keys | Until manually cleared | Browser data clear |
| localStorage (anon ID, prefs) | Until manually cleared | Browser data clear |

## 8. Data Security

### 8.1 Client-Side Security

Since all processing occurs in your browser, data security is fundamentally dependent on:

- Your browser's security model (isolated per-origin storage)
- Your device's security posture (OS, antivirus, disk encryption)
- Your network security (HTTPS encryption in transit for app delivery)

### 8.2 Cryptographic Measures

The Service employs the following cryptographic measures:

- **Ed25519 signatures** — RAIN-CERT provenance certificates signed via Web Crypto API (`src/lib/rain/provenance.ts`)
- **SHA-256 hashing** — Audio content hashes for provenance verification
- **HMAC-SHA256** — AIE voice vector export signatures (`src/lib/rain/aie.ts`)
- **HTTPS** — All static file delivery over TLS

### 8.3 Security Limitations

As a browser-based application, RAIN is subject to the security limitations of the browser platform. We do not:

- Encrypt IndexedDB data at rest (browser standard limitation)
- Implement server-side authentication (no accounts in Beta)
- Provide end-to-end encrypted messaging or storage services

## 9. Children's Privacy

RAIN V6 is not directed at individuals under the age of 18. We do not knowingly collect personal information from children. As we do not collect any personal information from any users during the Beta phase, this risk is inherently mitigated.

## 10. International Data Transfers

### 10.1 No Transfers Occur

Since we collect no user data, **no international data transfers occur.** All audio processing happens in your browser, on your device, in your jurisdiction.

### 10.2 Static File Delivery

The application's static files (HTML, JS, CSS, WASM, ONNX model) may be served from content delivery networks (CDNs) with global points of presence. These CDN providers:

- Serve only public static assets (identical for all users)
- Do not receive any user-specific data
- Are governed by their own privacy policies for network-level data (which is inherent to all internet communication)

## 11. Your Rights (POPIA Section 5)

Under the Protection of Personal Information Act, you have the following rights. While we do not collect personal information, we respect and support these rights:

### 11.1 Right to Be Informed

You have the right to know what personal information we collect and how we use it. This document serves that purpose.

### 11.2 Right of Access

You have the right to request access to any personal information we hold about you. We hold none during Beta.

### 11.3 Right to Rectification

You have the right to request correction of inaccurate personal information.

### 11.4 Right to Erasure

You have the right to request deletion of your personal information. All local data can be deleted by you directly using your browser's tools or the RAIN interface's "Clear Analytics" and "Reset Identity" functions.

### 11.5 Right to Object

You have the right to object to the processing of your personal information.

### 11.6 Right to Data Portability

You have the right to receive your personal information in a structured, commonly used format. You can export your AIE voice vector as a signed JSON file via the RAIN interface. Render history and analytics data can be inspected via your browser's Developer Tools.

### 11.7 Right to Complain

You have the right to lodge a complaint with the **Information Regulator (South Africa)**:

- **Website:** https://www.justice.gov.za/inforeg/
- **Email:** inforeg@justice.gov.za
- **Phone:** +27 (0)12 406 4818

## 12. Changes to This Privacy Policy

We reserve the right to update this Privacy Policy at any time. Changes will be effective immediately upon posting. We will make reasonable efforts to notify you of material changes through the RAIN interface.

---

**© ThatGuy Productions / ARCOVEL Technologies International. All Rights Reserved.**

**Contact:** legal@rainv6.com | **Jurisdiction:** Republic of South Africa
