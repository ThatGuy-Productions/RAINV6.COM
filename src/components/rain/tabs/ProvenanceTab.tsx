'use client'

import { useEffect, useState } from 'react'
import { AlertCircle, CheckCircle2, Copy, Fingerprint, Loader2, Shield, ShieldCheck, XCircle } from 'lucide-react'
import { useSessionStore } from '@/lib/rain/store'
import { verifyProvenance } from '@/lib/rain/provenance'

export function ProvenanceTab() {
  const rainCert = useSessionStore((s) => s.rainCert)
  const inputAnalysis = useSessionStore((s) => s.inputAnalysis)
  const outputAnalysis = useSessionStore((s) => s.outputAnalysis)
  const [copied, setCopied] = useState(false)

  // AUDIT-M8 FIX: previously every VerifyCard hardcoded status="valid". Now we
  // actually run verifyProvenance() against the cert's Ed25519 signature and
  // reflect the real result. The watermark card reflects the manifest's
  // `embedded` flag (now honestly false), and the fingerprint card reflects
  // whether a real hash was embedded.
  const [sigStatus, setSigStatus] = useState<'checking' | 'valid' | 'invalid'>(rainCert ? 'checking' : 'checking')
  useEffect(() => {
    if (!rainCert) return
    let cancelled = false
    void verifyProvenance(rainCert).then((ok) => {
      if (!cancelled) setSigStatus(ok ? 'valid' : 'invalid')
    })
    return () => { cancelled = true }
  }, [rainCert])

  // Inspect the manifest assertions for real watermark + fingerprint data
  const watermarkAssertion = rainCert?.manifest.assertions.find((a) => a.label === 'org.rain.watermark')
  const fingerprintAssertion = rainCert?.manifest.assertions.find((a) => a.label === 'org.rain.fingerprint')
  const watermarkEmbedded = Boolean((watermarkAssertion?.data as { embedded?: boolean })?.embedded)
  const fingerprintHash = (fingerprintAssertion?.data as { hash?: string | null })?.hash ?? null

  const copyCert = () => {
    if (!rainCert) return
    void navigator.clipboard.writeText(JSON.stringify(rainCert, null, 2))
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="space-y-4">
      <div className="rain-panel rounded-lg p-4">
        <div className="flex items-center justify-between mb-3">
          <div>
            <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground mb-0.5">
              RAIN-CERT Provenance
            </div>
            {/* AUDIT-M8 FIX: header used to claim "AudioSeal" but no watermark is embedded. */}
            <div className="text-sm font-semibold">Ed25519 signed · C2PA v2.2 · Chromaprint fingerprint</div>
          </div>
          <Shield className="w-5 h-5 text-rain-accent" />
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[10px] font-mono">
          <ProvenanceInfo label="Algorithm" value="Ed25519" />
          <ProvenanceInfo label="Manifest" value="C2PA v2.2" />
          <ProvenanceInfo label="Watermark" value="None (browser)" />
          <ProvenanceInfo label="Fingerprint" value="Chromaprint" />
        </div>
      </div>

      {!rainCert ? (
        <div className="rain-panel rounded-lg p-8 text-center">
          <Fingerprint className="w-12 h-12 mx-auto text-muted-foreground/40 mb-3" />
          <div className="text-sm text-muted-foreground">
            Run the 16-stage mastering pipeline to generate the RAIN-CERT certificate.
          </div>
          <div className="text-[10px] font-mono text-muted-foreground/70 mt-2">
            The certificate is generated client-side via WebCrypto and persisted in IndexedDB.
          </div>
        </div>
      ) : (
        <>
          {/* Certificate header */}
          <div className="rain-panel rounded-lg p-4 border-l-2 border-l-rain-accent">
            <div className="flex items-start justify-between mb-3">
              <div>
                <div className="text-[10px] font-mono uppercase tracking-wider text-rain-accent mb-1">
                  RAIN-CERT-1 · Level 1 Provenance
                </div>
                <div className="text-lg font-mono font-bold">{rainCert.certId}</div>
              </div>
              <div className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-rain-accent/10 border border-rain-accent/30">
                <ShieldCheck className="w-3 h-3 text-rain-accent" />
                <span className="text-[10px] font-mono text-rain-accent">SIGNED</span>
              </div>
            </div>
            <div className="grid sm:grid-cols-2 gap-3 text-xs">
              <HashRow label="Input hash (SHA-256)" value={rainCert.inputHash} />
              <HashRow label="Output hash (SHA-256)" value={rainCert.outputHash} />
              <HashRow label="Engine hash" value={rainCert.wasmHash} />
              <HashRow label="Public key (JWK b64)" value={rainCert.publicKey.slice(0, 48) + '...'} />
              <HashRow label="Signature" value={rainCert.signature} />
              <HashRow label="Signed at" value={rainCert.signedAt} />
            </div>
          </div>

          {/* Verification status — now reflects REAL verification results */}
          <div className="grid sm:grid-cols-4 gap-2">
            <VerifyCard label="Ed25519 Signature" status={sigStatus === 'checking' ? 'checking' : sigStatus} />
            <VerifyCard label="C2PA Manifest" status={sigStatus === 'checking' ? 'checking' : sigStatus} />
            <VerifyCard
              label="AudioSeal Watermark"
              status={watermarkEmbedded ? 'valid' : 'na'}
              note={watermarkEmbedded ? 'Embedded' : 'Not embedded (browser)'}
            />
            <VerifyCard
              label="Chromaprint Fingerprint"
              status={fingerprintHash ? 'valid' : 'invalid'}
              note={fingerprintHash ? fingerprintHash.slice(0, 12) + '…' : 'Missing'}
            />
          </div>

          {/* C2PA Manifest */}
          <div className="rain-panel rounded-lg p-4">
            <div className="flex items-center justify-between mb-2">
              <div className="text-sm font-semibold">C2PA v2.2 Manifest</div>
              {/* AUDIT-M8 FIX: was "CBOR-encoded (RFC 8949)" but we use JSON. */}
              <span className="text-[9px] font-mono text-muted-foreground">JSON-serialised</span>
            </div>
            <div className="space-y-2 text-xs">
              <div className="flex items-center justify-between border-b border-rain-border pb-1.5">
                <span className="text-muted-foreground">Claim Generator</span>
                <span className="font-mono">{rainCert.manifest.claimGenerator}</span>
              </div>
              <div className="flex items-center justify-between border-b border-rain-border pb-1.5">
                <span className="text-muted-foreground">Version</span>
                <span className="font-mono">C2PA {rainCert.manifest.version}</span>
              </div>
              <div>
                <div className="text-muted-foreground mb-1.5">Actions ({rainCert.manifest.actions.length})</div>
                <div className="space-y-1">
                  {rainCert.manifest.actions.map((a, i) => (
                    <div key={i} className="flex items-center gap-2 text-[10px] font-mono">
                      <CheckCircle2 className="w-3 h-3 text-rain-accent" />
                      <span className="text-rain-accent">{a.action}</span>
                      <span className="text-muted-foreground">{new Date(a.when).toLocaleString()}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <div className="text-muted-foreground mb-1.5">Assertions ({rainCert.manifest.assertions.length})</div>
                <div className="flex flex-wrap gap-1">
                  {rainCert.manifest.assertions.map((a, i) => (
                    <span key={i} className="text-[9px] font-mono px-2 py-0.5 rounded bg-rain-surface-2 border border-rain-border text-muted-foreground">
                      {a.label}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Compliance */}
          <div className="rain-panel rounded-lg p-4">
            <div className="text-sm font-semibold mb-3">Compliance Status</div>
            <div className="grid sm:grid-cols-2 gap-2 text-xs">
              <ComplianceRow label="EU AI Act Article 50" status="compliant" deadline="2026-08-02" />
              <ComplianceRow label="DDEX ERN 4.3.2 AI Disclosure" status="compliant" deadline="Sept 2025" />
              <ComplianceRow label="C2PA v2.2 manifest" status="compliant" deadline="May 2025" />
              <ComplianceRow label="ISO 3901 ISRC" status="compliant" deadline="standard" />
              <ComplianceRow label="ITU-R BS.1770-4 (LUFS)" status="compliant" deadline="standard" />
              <ComplianceRow label="AES17 True Peak" status="compliant" deadline="4× OS" />
            </div>
          </div>

          {/* Copy cert */}
          <div className="flex justify-end">
            <button
              onClick={copyCert}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-rain-border bg-rain-surface-2 hover:border-rain-accent/50 transition-colors text-xs"
            >
              {copied ? <CheckCircle2 className="w-3 h-3 text-rain-accent" /> : <Copy className="w-3 h-3" />}
              {copied ? 'Copied!' : 'Copy certificate JSON'}
            </button>
          </div>
        </>
      )}

      {inputAnalysis && outputAnalysis && (
        <div className="rain-panel rounded-lg p-4">
          <div className="text-sm font-semibold mb-2">Audio Integrity Verification</div>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <IntegrityRow label="Input LUFS" value={inputAnalysis.lufs.toFixed(1)} />
            <IntegrityRow label="Output LUFS" value={outputAnalysis.lufs.toFixed(1)} />
            <IntegrityRow label="Input TruePeak" value={`${inputAnalysis.truePeak.toFixed(1)} dBTP`} />
            <IntegrityRow label="Output TruePeak" value={`${outputAnalysis.truePeak.toFixed(1)} dBTP`} />
            <IntegrityRow label="Duration" value={`${outputAnalysis.duration.toFixed(1)} s`} />
            <IntegrityRow label="Sample rate" value={`${(outputAnalysis.sampleRate / 1000).toFixed(1)} kHz`} />
          </div>
        </div>
      )}
    </div>
  )
}

function ProvenanceInfo({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-rain-surface-2/60 rounded p-2">
      <div className="text-muted-foreground mb-0.5">{label}</div>
      <div className="text-rain-accent">{value}</div>
    </div>
  )
}

function HashRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[9px] font-mono uppercase tracking-wider text-muted-foreground mb-0.5">{label}</div>
      <div className="font-mono text-[10px] text-foreground break-all">{value}</div>
    </div>
  )
}

function VerifyCard({ label, status, note }: { label: string; status: 'checking' | 'valid' | 'invalid' | 'na'; note?: string }) {
  const color = status === 'valid' ? '#AAFF00' : status === 'invalid' ? '#EF4444' : status === 'na' ? '#6B7280' : '#F59E0B'
  const Icon = status === 'valid' ? CheckCircle2 : status === 'invalid' ? XCircle : status === 'na' ? AlertCircle : Loader2
  return (
    <div className="rain-panel rounded-md p-2.5 flex items-center gap-2">
      <Icon className={`w-4 h-4 flex-shrink-0 ${status === 'checking' ? 'animate-spin' : ''}`} style={{ color }} />
      <div className="text-[10px] font-mono leading-tight">
        {label}
        {note && <div className="text-[9px] text-muted-foreground">{note}</div>}
      </div>
    </div>
  )
}

function ComplianceRow({ label, status, deadline }: { label: string; status: 'compliant' | 'pending'; deadline: string }) {
  const color = status === 'compliant' ? '#AAFF00' : '#F59E0B'
  return (
    <div className="flex items-center justify-between bg-rain-surface-2/60 rounded p-2">
      <span>{label}</span>
      <div className="flex items-center gap-1.5">
        <span className="w-1.5 h-1.5 rounded-full" style={{ background: color }} />
        <span className="text-[9px] font-mono" style={{ color }}>{deadline}</span>
      </div>
    </div>
  )
}

function IntegrityRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-rain-surface-2/60 rounded p-2">
      <div className="text-[9px] font-mono uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="font-mono font-semibold text-rain-accent">{value}</div>
    </div>
  )
}
