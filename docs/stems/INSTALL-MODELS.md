# Install stem separation models (4-pass / 12-stem)

Product goal: **12 stems** via a **4-pass cascade**.

| Pass | Role | Preferred | Open fallback |
|------|------|-----------|---------------|
| 1 | 6-stem backbone | **BS-RoFormer** | **Demucs HTDemucs 6s** (MIT) |
| 2 | Lead / backing vocals | MelBand karaoke | Spectral split until model present |
| 3 | Kick / snare / hats / perc | Drum cascade model | Spectral band-split |
| 4 | Ambience / other | Residual model | Residual subtraction |

## Directory layout

```
public/models/stems/
  bs_roformer_6s.onnx
  bs_roformer_6s.onnx.data          # if external data
  bs_roformer_6s.manifest.json
  htdemucs_6s.onnx                  # Demucs fallback
  htdemucs_6s.onnx.data
  htdemucs_6s.manifest.json
  melband_karaoke.onnx              # optional pass 2
  drumsep.onnx                      # optional pass 3
  residual_ambience.onnx            # optional pass 4
```

Each `*.manifest.json` must include:

```json
{
  "modelName": "htdemucs_6s",
  "schemaVersion": 1,
  "checksums": {
    "sha256": "<64 hex of onnx file>",
    "sha256ExternalData": "<64 hex of .onnx.data if any>"
  },
  "sampleRate": 44100,
  "outputs": ["drums", "bass", "other", "vocals", "guitar", "piano"]
}
```

## Demucs (open) — recommended first install

1. Export or obtain an **ONNX** build of `htdemucs_6s` (MIT Demucs).
2. Place files under `public/models/stems/` with matching manifest hashes.
3. Commit via **Git LFS** (`*.onnx`, `*.onnx.data`).
4. Reload the app — `resolvePass1Backend()` will select Demucs when verified.

## BS-RoFormer (preferred quality)

1. Obtain **redistributable** BS-RoFormer weights under a license that allows shipping in RAIN.
2. Export ONNX with documented input/output names.
3. Install as `bs_roformer_6s.onnx` + manifest.
4. Pass 1 prefers BS-RoFormer over Demucs when both verify.

## Runtime

- Loader: `src/lib/rain/stems-onnx.ts` (WebGPU → WASM)
- Cascade: `src/lib/rain/stems-cascade.ts`
- Registry: `src/lib/rain/stems-model-registry.ts`

We do **not** remove the 12-stem product claim. We implement the cascade and enable neural inference as soon as verified weights are present.
