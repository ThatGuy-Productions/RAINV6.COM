---
title: "RAIN V6 Beta — Data Processing Agreement"
version: "1.0.0-beta"
effective: "2026-07-31"
jurisdiction: "South Africa"
company: "ThatGuy Productions / ARCOVEL Technologies International"
license: "Proprietary"
---

# RAIN V6 Beta — Data Processing Agreement (DPA)

**Effective Date:** 31 July 2026

**Last Updated:** 31 July 2026

> **Draft status:** This document contains legacy beta statements that are being reconciled with persistent account and project metadata storage. It is not ready to be relied upon as a final DPA until hosting/sub-processor details, retention/deletion, data-subject request handling, and legal review are complete.

## 1. Introduction

This Data Processing Agreement ("DPA") forms part of the RAIN V6 Beta Terms of Service and Privacy Policy. It defines the roles, responsibilities, and obligations of the parties with respect to the processing of personal data (as defined by the Protection of Personal Information Act, 2013 ("POPIA") and applicable data protection laws).

### 1.1 Parties

- **Data Controller:** The individual user of RAIN V6 Beta ("User," "you," "Data Controller")
- **Data Processor:** ARCOVEL Technologies International, operating as ThatGuy Productions ("RAIN," "we," "us," "Data Processor")

### 1.2 Scope

This DPA applies to the processing of personal data that may occur in the context of the RAIN V6 Beta service.

### 1.3 Relationship to Other Agreements

This DPA supplements the RAIN V6 Beta Terms of Service and Privacy Policy. In the event of any conflict between this DPA and the Terms of Service regarding data processing, this DPA shall prevail.

## 2. Data Processing Roles

### 2.1 Data Controller (You)

As the Data Controller, you:

- Determine the purposes and means of processing any personal data you introduce into the Service
- Are responsible for the lawfulness of the processing, including obtaining any necessary consents
- Retain full ownership and control over all audio content and any associated personal data
- Are responsible for complying with your obligations as a Data Controller under POPIA and applicable law

### 2.2 Data Processor (RAIN)

As the Data Processor, we:

- Process personal data only on your documented instructions
- Implement appropriate technical and organisational measures to protect data
- Assist you in fulfilling your obligations as Data Controller
- Do not determine the purposes or means of processing
- Do not sell, share, or otherwise commercialise any personal data

### 2.3 Browser Processing and Account Persistence

RAIN performs source-audio processing in the browser by default. However, the service also supports persistent accounts and may store account email, optional display name, salted password hashes, authentication-token hashes/expiry, saved project metadata/settings, render records, and limited operational event metadata in PostgreSQL. Authentication records may include user-agent and IP metadata for security. Source audio and AIE voice vectors remain browser-local under the account/project persistence design described here.

This means RAIN does process a limited category of personal/account data on its servers; statements elsewhere in this DPA that claim zero server-side data or stateless operation must be read as superseded by this section and must be reconciled before the policy is published as final. The database hosting provider, hosting region, retention/deletion schedule, and sub-processor terms must be identified and reviewed before production account persistence is enabled.

## 3. Nature and Purpose of Processing

### 3.1 Processing Activities

The Service performs the following processing activities, all of which occur **entirely within the User's browser:**

| Processing Activity | Purpose | Data Involved | Location |
|--------------------|---------|--------------|----------|
| Audio file loading | Mastering input | User's audio files (WAV, MP3, FLAC) | Browser RAM |
| Audio decoding | Convert to float32 PCM | Decoded audio samples | Browser RAM / Web Worker |
| DSP pipeline (16 stages) | Audio mastering | Audio samples + processing parameters | Web Worker |
| RainNet v2 inference | AI parameter generation | Mel spectrogram features | Web Worker / WebAssembly |
| QC validation (18 checks) | Quality assessment | Audio samples + target specs | Web Worker |
| Audio encoding (WAV/MP3) | Output generation | Processed audio samples | Browser RAM |
| DDEX ERN 4.3.2 packaging | Distribution package | Metadata + audio files | Browser RAM |
| RAIN-CERT signing (Ed25519) | Provenance | Audio hashes + manifest JSON | Web Crypto API |
| AIE voice vector computation | Personalised mastering | Mel-band energy features | Web Audio API |

### 3.2 Categories of Data Subjects

The only potential data subjects are the Users themselves. No personal data of other individuals is processed unless the User introduces it through uploaded audio content, metadata, or artist information.

### 3.3 Categories of Personal Data

In the normal course of account-enabled use, limited account/security data and saved project metadata/settings may be processed on RAIN's servers. The following categories remain browser-local unless a separate, explicitly disclosed feature changes this:

| Data Category | Example | Server Access |
|---------------|---------|---------------|
| Source audio | Song recordings | None through the account/project persistence API |
| Embedded audio metadata | ID3 tags, RIFF INFO, BWF bext | Not uploaded with saved project metadata |
| AIE voice vector | 64-dim float32 array | None; remains browser-local |
| Provenance private key | IndexedDB key | None; remains browser-local |
| UI preferences | Theme, language selection | Local unless explicitly included in saved project settings |
| Account data | Email, optional name, salted password hash | Stored in PostgreSQL |
| Authentication metadata | Token hash, expiry, user-agent, IP metadata | Stored in PostgreSQL |
| Saved project metadata | Project name, processing settings, input hash | Stored in PostgreSQL for signed-in users |
| Operational events | Signup/login/session/render/export/AIE event types and limited metadata | Stored where the relevant event path succeeds; not historical for periods before instrumentation |

## 4. Sub-Processors

### 4.1 Hosting and Sub-Processors

The browser uses built-in Web Audio, WebAssembly, Web Crypto, IndexedDB, and LocalStorage APIs for local processing. Persistent account data and saved project metadata require a PostgreSQL hosting provider. The production provider, hosting region, contractual data-protection terms, and any other sub-processors must be identified and listed here before production account persistence is enabled. Until that is completed, this DPA is a draft and must not be represented as a final account-data processing agreement.

### 4.2 Future Sub-Processors

Before adding or changing server-side processing or sub-processors, we will:

1. Update this DPA to include a sub-processor list
2. Provide at least 30 days' notice before engaging any sub-processor
3. Enter into written agreements with sub-processors containing data protection obligations no less protective than those in this DPA
4. Remain fully liable for sub-processor compliance

### 4.3 CDN Providers

Static application files (HTML, JS, CSS, WASM, ONNX model) may be delivered via Content Delivery Networks. CDN providers:

- Deliver only public static assets (identical for all users)
- Do not receive or process any user-specific data
- Are not considered sub-processors under this DPA

## 5. Technical and Organisational Security Measures

### 5.1 Cryptographic Measures

| Measure | Implementation | Purpose |
|---------|---------------|---------|
| Ed25519 signing | `src/lib/rain/provenance.ts` — Web Crypto API | Authenticate provenance certificates |
| SHA-256 hashing | `src/lib/rain/provenance.ts` — Web Crypto API | Content integrity verification |
| HMAC-SHA256 | `src/lib/rain/aie.ts` — Web Crypto API | Voice vector export signing |
| UUIDv4 random | `src/lib/rain/anon-id.ts` — `crypto.randomUUID()` | Anonymous session identification |
| ONNX model integrity | File hash verification on load | Ensure authentic RainNet v2 model |
| HTTPS/TLS | Transport encryption for all assets | Protect data in transit |

### 5.2 Architectural Security

| Measure | Description |
|---------|-------------|
| Client-side only processing | Audio never leaves the user's browser |
| Durable account storage | PostgreSQL stores account, authentication, saved-project metadata, and limited event records when configured |
| Browser security sandbox | Data isolated per-origin by browser policy |
| Web Worker isolation | DSP runs in a separate thread, no DOM access |
| Persistent account state | Authentication tokens, account records, saved project metadata, and event rows are stored server-side |
| IndexedDB per-origin isolation | Data accessible only to RAIN application origin |

### 5.3 Organisational Measures

| Measure | Description |
|---------|-------------|
| Restricted data access | Limit server-side access to account, authentication, saved-project metadata, and event records; apply least privilege and audit access |
| Operational access | Restrict and audit privileged access to server-side account and project metadata |
| Least privilege | Code module design limits data access to specific processing stages |
| Open source-available | Source code available for security audit |

## 6. Data Breach Notification

### 6.1 Client-Side Breach

In the event of a security incident that could affect locally stored data (e.g., a vulnerability in the RAIN application code that could expose IndexedDB data to other origins), we will:

1. Investigate the incident within 24 hours of discovery
2. Notify affected users through the RAIN application interface within 72 hours
3. Publish a security advisory on the RAIN documentation site
4. Deploy a fix as soon as technically feasible
5. Provide clear instructions for users to verify and secure their locally stored data

### 6.2 Server-Side Breach

In the unlikely event of a server-side security breach (affecting the delivery of static assets or the integrity of the application code):

1. We will take the affected systems offline immediately
2. We will notify users through available channels within 24 hours
3. We will publish a detailed incident report within 7 days
4. We will implement remediation measures before restoring service

### 6.3 Notification Content

Data breach notifications will include:

- Description of the nature of the breach
- Categories and approximate number of data subjects affected (if determinable)
- Likely consequences of the breach
- Measures taken or proposed to address the breach
- Contact point for further information (legal@rainv6.com)
- Recommendations for affected users

## 7. Audit Rights

### 7.1 Client-Side Transparency

Because all processing occurs in the User's browser, the User has **full transparency** into the data processing performed by RAIN:

- All RAIN source code is available for inspection (repository access)
- All network requests can be monitored via browser Developer Tools
- All locally stored data can be inspected via browser Developer Tools (IndexedDB, localStorage)
- All cryptographic operations are verifiable through the Web Crypto API
- All audio processing can be independently verified by comparing input and output files

### 7.2 Source Code Audit

The RAIN V6 source code is available at the repository. Users and their designated auditors may:

- Review the source code to verify data handling practices
- Build the application from source and compare with the deployed version
- Verify that no data exfiltration code exists
- Inspect all network request code paths

### 7.3 Formal Audit Requests

For formal audit requests beyond source code inspection, please contact **legal@rainv6.com**. We will:

- Respond within 14 days
- Provide any additional documentation reasonably requested
- Cooperate with legitimate audit requests from regulatory authorities

### 7.4 Limitations

Because RAIN supports persistent accounts and server-side project metadata, database, access-control, backup, retention, and security-log audits may be relevant. Audit procedures and access scope must be agreed and documented before this DPA is finalized.

## 8. Data Retention and Deletion

### 8.1 Processor Obligations

RAIN may retain account, authentication, saved-project metadata, render, and operational event records in PostgreSQL. The exact retention schedule, account deletion process, and handling of backups must be finalized before this DPA is treated as effective.

### 8.2 Controller Control

Audio, AIE voice vectors, and provenance private keys remain local under the current browser-processing design. Account and saved-project metadata may be stored server-side. Local data can be deleted through:

- The "Clear Analytics" function in the RAIN interface
- The "Reset Identity" function in the RAIN interface
- Standard browser data clearing mechanisms (Settings → Clear browsing data)
- Uninstalling the browser

RAIN will provide reasonable assistance to the Data Controller for data deletion upon request, to the extent such assistance is applicable given the client-side architecture.

## 9. International Data Transfers

### 9.1 No Transfers Occur

The location of server-side account and project records depends on the configured PostgreSQL hosting provider. The hosting region, any international transfers, and applicable safeguards must be identified and disclosed before account persistence is enabled in production.

### 9.2 User-Initiated Transfers

If the Data Controller chooses to use RAIN in a jurisdiction different from where the audio was created, or if the Data Controller downloads mastered audio and transfers it internationally, such transfers are initiated and controlled exclusively by the Data Controller and are outside the scope of this DPA.

## 10. Assistance to the Data Controller

### 10.1 Data Subject Requests

The parties' responsibilities for data-subject access, correction, deletion, and portability requests must account for server-side account and project metadata. The operational request process and response timelines must be confirmed before this DPA is finalized.

Should RAIN receive a data subject request directly, we will:

1. Acknowledge receipt within 72 hours
2. Verify whether RAIN holds account, authentication, saved-project, or operational event data about the data subject
3. Direct the data subject to the Data Controller if applicable
4. Provide reasonable cooperation to the Data Controller upon request

### 10.2 Data Protection Impact Assessments

Upon request, RAIN will provide the Data Controller with information reasonably necessary to conduct a Data Protection Impact Assessment (DPIA), including:

- Description of processing operations (as detailed in this DPA)
- Security measures (as detailed in Section 5)
- The confirmed hosting provider, sub-processor list, and data-location/transfer safeguards

### 10.3 Prior Consultation

Should a Data Controller be required to consult with a supervisory authority regarding the processing, RAIN will provide reasonable assistance and information.

## 11. Confidentiality

Personnel with privileged access to application infrastructure or the PostgreSQL service must be subject to confidentiality obligations and least-privilege access controls. Actual access logging and operational controls must be verified before production launch.

## 12. Liability

The liability provisions of the RAIN V6 Beta Terms of Service (Section 8: Limitation of Liability) apply to this DPA. Specifically:

- RAIN's total aggregate liability under this DPA shall not exceed R0.00 (ZAR)
- RAIN shall not be liable for indirect, incidental, or consequential damages
- These draft provisions must be reviewed for consistency with the actual data-processing model and applicable law before publication

## 13. Term and Termination

### 13.1 Term

This DPA shall remain in effect for as long as the Data Controller uses RAIN V6 Beta.

### 13.2 Termination

This DPA terminates automatically upon:

- Termination of the Terms of Service
- Cessation of use of the Service by the Data Controller
- End of the Beta phase and introduction of a successor DPA

### 13.3 Effect of Termination

Upon termination, the Data Processor's obligations cease. As no data is held by the Data Processor, no data return or deletion process is required.

## 14. Governing Law

This DPA shall be governed by the laws of the Republic of South Africa, in accordance with the governing law provision in the Terms of Service.

---

**© ThatGuy Productions / ARCOVEL Technologies International. All Rights Reserved.**

**Contact:** legal@rainv6.com | **Jurisdiction:** Republic of South Africa
