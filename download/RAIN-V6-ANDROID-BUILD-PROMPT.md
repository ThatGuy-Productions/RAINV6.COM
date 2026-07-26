# RAIN V6 Android App — Complete Build Prompt for Android Studio AI

## PASTE THIS ENTIRE PROMPT INTO ANDROID STUDIO AI (Gemini / Studio Bot)

---

## PROJECT SPECIFICATION

Build a production-ready Android app called "RAIN V6" — an AI audio mastering studio that runs entirely on-device. The app is the Android counterpart to the RAIN V6 web beta. It delivers real in-browser DSP mastering, Ed25519 provenance certificates, AI-powered macro suggestions, and file export — all running locally on the Android device with no audio uploads to any server.

### App Identity
- **Name:** RAIN V6
- **Package:** com.thatguyproductions.rainv6
- **Min SDK:** 26 (Android 8.0)
- **Target SDK:** 35 (Android 15)
- **Language:** Kotlin
- **UI:** Jetpack Compose + Material Design 3
- **Architecture:** MVVM + Clean Architecture
- **Theme:** Dark-first, lime-green (#AAFF00) accent on near-black (#0A0C10) background — matching the web studio aesthetic

### Core Philosophy
- **Local-first:** Audio processing happens on-device. Audio files never leave the phone.
- **Real DSP:** Implement actual ITU-R BS.1770-4 LUFS measurement, true-peak detection, multiband compression, look-ahead limiting — not simulated.
- **Honest:** No fake features. Every button does something real.
- **Material Design 3:** Dynamic colors, edge-to-edge, predictive back gestures.

---

## BUILD THE FOLLOWING:

### 1. PROJECT SETUP & DEPENDENCIES

Create a new Android project with:
- Empty Compose Activity
- Kotlin DSL build scripts (build.gradle.kts)
- Version catalog (libs.versions.toml)

Add these dependencies:
```
// Compose BOM
platform("androidx.compose:compose-bom:2024.12.01")
androidx.compose.ui:ui
androidx.compose.material3:material3
androidx.compose.ui:ui-tooling-preview
androidx.activity:activity-compose:1.9.3
androidx.lifecycle:lifecycle-viewmodel-compose:2.8.7
androidx.lifecycle:lifecycle-runtime-compose:2.8.7
androidx.navigation:navigation-compose:2.8.5

// Room (local database — mirrors the web app's Prisma schema)
androidx.room:room-runtime:2.6.1
androidx.room:room-ktx:2.6.1
androidx.room:room-compiler:2.6.1 (ksp)

// Networking (calls the RAIN V6 backend API for AI Co-Master + auth)
com.squareup.retrofit2:retrofit:2.11.0
com.squareup.retrofit2:converter-gson:2.11.0
com.squareup.okhttp3:logging-interceptor:4.12.0

// Audio
androidx.media3:media3-exoplayer:1.5.1
androidx.media3:media3-ui:1.5.1

// Coroutines
org.jetbrains.kotlinx:kotlinx-coroutines-android:1.9.0

// DataStore (preferences — theme, settings)
androidx.datastore:datastore-preferences:1.1.1

// Security (encrypted preferences for session token)
androidx.security:security-crypto:1.1.0-alpha06

// Hilt (DI)
com.google.dagger:hilt-android:2.53.1
com.google.dagger:hilt-compiler:2.53.1 (ksp)
androidx.hilt:hilt-navigation-compose:1.2.0

// WorkManager (background rendering)
androidx.work:work-runtime-ktx:2.10.0

// Lame for Android (MP3 encoding) — use this library:
// com.github.nickaknudson:android-lame:1.0.0 (or bundle lamejs compiled for Android)

// Accompanist (permissions)
com.google.accompanist:accompanist-permissions:0.36.0
```

### 2. THEME & DESIGN SYSTEM

Create `ui/theme/` with:

**Color.kt:**
```kotlin
// Dark-first color scheme matching the web studio
val RainPrimary = Color(0xFFAAFF00)       // Lime accent
val RainBackground = Color(0xFF0A0C10)   // Near-black
val RainSurface = Color(0xFF12141A)      // Panel surface
val RainSurfaceVariant = Color(0xFF1A1D24) // Elevated surface
val RainBorder = Color(0xFF2A2D34)       // Borders
val RainError = Color(0xFFEF4444)        // Red
val RainWarning = Color(0xFFF59E0B)      // Amber
val RainSuccess = Color(0xFF10B981)      // Emerald
val RainInfo = Color(0xFF06B6D4)         // Cyan

val RainDarkColorScheme = darkColorScheme(
    primary = RainPrimary,
    onPrimary = Color.Black,
    background = RainBackground,
    onBackground = Color.White,
    surface = RainSurface,
    onSurface = Color.White,
    surfaceVariant = RainSurfaceVariant,
    outline = RainBorder,
    error = RainError,
)
```

**Type.kt:** Use Material 3 typography with a monospace variant for technical readouts (LUFS, dB, Hz values).

**Theme.kt:**
```kotlin
@Composable
fun RainTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = RainDarkColorScheme,
        typography = RainTypography,
        content = content,
    )
}
```

### 3. NAVIGATION

Create `Navigation.kt` with these routes:
```
- "onboarding" (first-run tour)
- "landing" (marketing/home screen)
- "studio" (mastering workspace)
- "export" (export settings + download)
- "tools" (free tools list)
- "tools/{slug}" (individual tool)
- "auth/signup"
- "auth/signin"
- "settings"
- "provenance" (certificate viewer)
- "whatsnew" (changelog)
```

Use a `NavHost` with animated transitions (slide horizontal). Bottom navigation bar with 4 tabs: Studio, Tools, Settings, Account.

### 4. DATA LAYER

#### 4a. Room Database

Create `data/db/` with these entities (mirrors the web app's Prisma schema):

**AccountEntity:**
```kotlin
@Entity(tableName = "accounts")
data class AccountEntity(
    @PrimaryKey val id: String,
    val email: String,
    val name: String?,
    val tier: String = "free",
    val createdAt: Long,
    val lastActiveAt: Long,
)
```

**SessionEntity** (mastering sessions):
```kotlin
@Entity(tableName = "sessions")
data class SessionEntity(
    @PrimaryKey val id: String,
    val userId: String?,
    val fileName: String,
    val inputFilePath: String,    // Local file URI
    val durationSec: Float,
    val sampleRate: Int,
    val channels: Int,
    val status: String,           // draft, processing, completed, failed
    val createdAt: Long,
)
```

**RenderEntity** (export history):
```kotlin
@Entity(tableName = "renders")
data class RenderEntity(
    @PrimaryKey val id: String,
    val sessionId: String,
    val format: String,           // wav24, wav16, mp3_320
    val outputFilePath: String,
    val outputFileHash: String?,
    val loudnessLufs: Float?,
    val truePeakDbfs: Float?,
    val renderTimeMs: Long?,
    val createdAt: Long,
)
```

**ReviewEntity** (user reviews):
```kotlin
@Entity(tableName = "reviews")
data class ReviewEntity(
    @PrimaryKey val id: String,
    val name: String,
    val role: String?,
    val rating: Int,
    val title: String,
    val body: String,
    val approved: Boolean,
    val createdAt: Long,
)
```

Create DAOs with standard CRUD operations for each entity.

#### 4b. Retrofit API Client

Create `data/api/RainApi.kt`:
```kotlin
interface RainApi {
    // Auth
    @POST("api/rain/auth/register")
    suspend fun register(@Body body: RegisterRequest): Response<AuthResponse>

    @POST("api/rain/auth/login")
    suspend fun login(@Body body: LoginRequest): Response<AuthResponse>

    @POST("api/rain/auth/logout")
    suspend fun logout(): Response<Unit>

    @GET("api/rain/auth/me")
    suspend fun getMe(): Response<MeResponse>

    // AI Co-Master
    @POST("api/rain/assist")
    suspend fun assist(@Body body: AssistRequest): Response<AssistResponse>

    // Stats
    @GET("api/rain/stats")
    suspend fun getStats(): Response<StatsResponse>

    @GET("api/rain/reviews")
    suspend fun getReviews(): Response<ReviewsResponse>

    @POST("api/rain/reviews")
    suspend fun submitReview(@Body body: ReviewRequest): Response<ReviewResponse>
}
```

Base URL should be configurable in Settings (default: `https://your-rain-v6-backend.com/`).

#### 4c. Session Management

Create `data/session/SessionManager.kt`:
- Stores the session cookie/token using `EncryptedSharedPreferences`
- Attaches the cookie to all Retrofit requests via an OkHttp Interceptor
- Clears the token on logout
- Exposes `isLoggedIn: StateFlow<Boolean>` and `currentUser: StateFlow<AccountEntity?>`

### 5. AUDIO ENGINE (THE CORE)

Create `audio/` package with:

#### 5a. AudioDecoder.kt
```kotlin
class AudioDecoder {
    // Decode any audio file (WAV, MP3, FLAC, AAC, OGG, M4A, AIFF) to PCM
    // Use MediaExtractor + MediaCodec to decode to 16-bit PCM
    // Return a DecodedAudio object containing:
    //   - sampleRate: Int (resample to 48000)
    //   - channels: Int (1 or 2)
    //   - samples: FloatArray (interleaved, normalized -1.0 to 1.0)
    //   - durationMs: Long

    fun decode(uri: Uri): DecodedAudio
}
```

#### 5b. DSP Pipeline — `audio/dsp/`

**LufsMeter.kt** — ITU-R BS.1770-4 K-weighted LUFS measurement:
```kotlin
class LufsMeter(sampleRate: Int, channels: Int) {
    // Stage 1: K-weighting filter (high-shelf + high-pass cascade)
    //   - High-shelf: b0=1.53512485958697, b1=-2.69169618940638, b2=1.19839281085285
    //     a1=-1.69065929318241, a2=0.73248077421585
    //   - High-pass (RLB): b0=1.0, b1=-2.0, b2=1.0, a1=-1.99004745483398, a2=0.99007225036621
    // Stage 2: Mean square of filtered samples
    // Stage 3: Integration (400ms block, 75% overlap)
    // Returns: integrated LUFS, short-term LUFS, momentary LUFS
}
```

**TruePeakMeter.kt** — 4× oversampled true-peak detection:
```kotlin
class TruePeakMeter(sampleRate: Int) {
    // 4× polyphase oversampling (FIR interpolation)
    // Measure peak in dBFS
    // Returns: truePeakDbfs
}
```

**BiquadFilter.kt** — RBJ biquad filter design:
```kotlin
class BiquadFilter(val type: Type, sampleRate: Int, freq: Double, q: Double, gainDb: Double) {
    enum class Type { LOWPASS, HIGHPASS, BANDPASS, NOTCH, PEAK, LOWSHELF, HIGHSHELF }

    // RBJ Audio EQ Cookbook formulas
    // Process a block of FloatArray samples in-place
    fun process(samples: FloatArray)
}
```

**MultibandCompressor.kt** — 3-band multiband compressor:
```kotlin
class MultibandCompressor(sampleRate: Int) {
    // Split into 3 bands using Linkwitz-Riley crossovers (240Hz, 1500Hz)
    // Per-band: threshold, ratio, attack, release, gain
    // Process stereo FloatArray
    fun process(left: FloatArray, right: FloatArray)
}
```

**Limiter.kt** — Look-ahead limiter with monotonic-deque max gain reduction:
```kotlin
class Limiter(sampleRate: Int, ceilingDb: Double = -1.0, lookaheadMs: Double = 5.0) {
    // Look-ahead buffer
    // Maximum gain reduction over lookahead window
    // Smooth gain changes
    // Returns processed FloatArray
    fun process(samples: FloatArray): FloatArray
}
```

**Dither.kt** — TPDF (Triangular Probability Density Function) dither:
```kotlin
object Dither {
    // Add TPDF noise before bit-depth reduction
    // Sum of two uniform random samples in [-0.5, +0.5) LSB
    fun apply(samples: FloatArray, targetBitDepth: Int): FloatArray
}
```

#### 5c. MasteringPipeline.kt — The 16-stage pipeline:
```kotlin
class MasteringPipeline(private val context: Context) {

    data class MacroValues(
        val brighten: Float, val glue: Float, val width: Float,
        val punch: Float, val warmth: Float, val space: Float, val repair: Float,
    )

    data class MasteringResult(
        val processedAudio: DecodedAudio,
        val inputAnalysis: AudioAnalysis,
        val outputAnalysis: AudioAnalysis,
        val renderTimeMs: Long,
        val rainScore: RainScore,
    )

    data class RainScore(
        val overall: Int,
        val spotify: Int, val apple: Int, val youtube: Int, val tidal: Int,
    )

    suspend fun process(
        input: DecodedAudio,
        macros: MacroValues,
        targetLufs: Double = -14.0,
        onProgress: (Float, String) -> Unit,  // 0.0-1.0, stage label
    ): MasteringResult

    // The 16 stages (each is a real function call):
    // 1. Format normalization (resample to 48kHz)
    // 2. Provenance record (SHA-256 input hash)
    // 3. Feature extraction (LUFS, true-peak, RMS, DR, BPM, key)
    // 4. AI inference (calls backend /api/rain/assist, or uses heuristic fallback)
    // 5. Reference matching (genre-aware spectral target)
    // 6. Spectral repair (HPF, de-essing, smoothing)
    // 7. Source separation (spectral heuristic — 12 stems, non-ML)
    // 8. Per-stem repair
    // 9. Per-stem processing (gain, solo/mute)
    // 10. Master bus (EQ → multiband → widening → saturation)
    // 11. Loudness targeting (apply gain to reach targetLufs)
    // 12. Spatial rendering (stereo width enhancement)
    // 13. QC validation (18-point check)
    // 14. Forensic watermark (LSB steganographic)
    // 15. Output packaging (WAV/MP3 encoding with TPDF dither)
    // 16. Distribution prep (DDEX manifest, if enabled)
}
```

#### 5d. AudioEncoders.kt:

**WavEncoder.kt:**
```kotlin
object WavEncoder {
    // Encode FloatArray PCM to WAV file (16-bit or 24-bit)
    // Standard RIFF/WAVE format
    // Optional: embed RAIN-CERT provenance in LIST/INFO chunk
    // Optional: LSB steganographic watermark
    fun encode(audio: DecodedAudio, bitDepth: Int = 24, outputPath: String): File
}
```

**Mp3Encoder.kt:**
```kotlin
object Mp3Encoder {
    // Encode to MP3 using LAME for Android
    // 320 kbps CBR, 48kHz
    // Optional ID3v2 tag embedding
    fun encode(audio: DecodedAudio, bitrate: Int = 320, outputPath: String): File
}
```

#### 5e. Provenance.kt — Ed25519 signing:
```kotlin
class ProvenanceManager(context: Context) {
    // Generate Ed25519 keypair using Java Security API
    // Persist to Android Keystore
    // Sign audio hash (SHA-256 of processed FloatArray)
    // Build RAIN-CERT certificate JSON:
    //   { inputHash, outputHash, signature, publicKey, timestamp, macros, analysis }
    // Verify a certificate against the public key
}
```

### 6. SCREENS (Jetpack Compose)

#### 6a. LandingScreen.kt
- Full-screen dark background with subtle animated gradient
- RAIN V6 logo + tagline "The AI Audio Operating System"
- "Launch Studio" button (lime, prominent)
- "Free Tools" button
- Service notice banner (dismissible, amber, same text as web)
- Stat counters (animate up when scrolled into view)
- Feature list (6 cards)
- FAQ accordion
- Reviews (from local Room DB, with submit form)

#### 6b. StudioScreen.kt (the main mastering workspace)
- **Top bar:** Back, "RAIN V6 Studio", account avatar, notifications bell
- **File upload zone:** Drag-drop or file picker (SAF). Shows file name, duration, sample rate, channels after load.
- **7 macro sliders:** Brighten, Glue, Width, Punch, Warmth, Space, Repair — each 0-10, with live value display and tooltip
- **Genre preset selector:** 12 genres (Pop, Rock, Hip-Hop, Electronic, Jazz, Classical, etc.)
- **AI Suggest button:** Calls backend /api/rain/assist, shows loading, applies returned macros
- **"Run 16-Stage Master" button:** Starts the pipeline, shows progress bar with stage labels
- **Real-time visualizers:**
  - Waveform (Canvas-drawn, shows input + output)
  - LUFS meter (vertical bar, input vs output)
  - RAIN Score gauge (circular progress)
- **A/B comparison toggle:** Switch between original and mastered audio for playback
- **Transport bar:** Play, pause, stop, seek, loop, volume

#### 6c. ExportScreen.kt
- Format selection: WAV 24-bit, WAV 16-bit, MP3 320 kbps
- Metadata fields: Title, Artist, Album, Year, ISRC (required before export)
- Provenance toggles: Embed certificate, embed signature, embed fingerprint, embed metadata, LSB watermark
- "Export Master" button (disabled until metadata is filled + user is signed in)
- Verification report after export (re-parses the file to verify embedding)
- Download/save to Music folder via SAF

#### 6d. ToolsScreen.kt (free tools)
- Grid of 35 tool cards (same as web)
- Categories: Audio Conversion, Audio Effects, Audio Tools, Image Conversion, PDF Tools
- Each card: name, description, output format badge
- Tap to open ToolDetailScreen

#### 6e. ToolDetailScreen.kt
- File picker (SAF)
- Tool-specific options (sliders for volume, bass boost, etc.)
- "Convert" button
- Progress indicator
- Download link for result file

#### 6f. AuthScreens.kt
- SignUpScreen: name, email, password, confirm password, password strength meter
- SignInScreen: email, password
- Both call backend API
- Success → navigate to studio
- Error → show message

#### 6g. SettingsScreen.kt
- Theme toggle (dark/light — dark is default)
- Backend URL configuration
- Provenance key management (generate, export, reset)
- Clear cache
- About / version

#### 6h. WhatsNewScreen.kt
- Changelog (same entries as web)
- Timeline UI with type badges (New, Fix, Improved)

### 7. VIEWMODELS

Create `viewmodel/` with:

**StudioViewModel.kt:**
```kotlin
@HiltViewModel
class StudioViewModel @Inject constructor(
    private val pipeline: MasteringPipeline,
    private val sessionManager: SessionManager,
    private val api: RainApi,
) : ViewModel() {

    data class StudioState(
        val loadedFile: DecodedAudio? = null,
        val fileName: String = "",
        val macros: MacroValues = MacroValues(5f, 5f, 5f, 5f, 5f, 5f, 0f),
        val isProcessing: Boolean = false,
        val progress: Float = 0f,
        val progressLabel: String = "",
        val result: MasteringResult? = null,
        val error: String? = null,
        val rainScore: RainScore? = null,
        val inputLufs: Float? = null,
        val outputLufs: Float? = null,
        val truePeak: Float? = null,
    )

    val state: StateFlow<StudioState>

    fun loadFile(uri: Uri)
    fun setMacro(name: String, value: Float)
    fun applyGenrePreset(genre: String)
    suspend fun runMastering()
    suspend fun aiSuggest()
    fun resetMacros()
}
```

### 8. WORKMANAGER (Background Rendering)

**MasteringWorker.kt:**
```kotlin
class MasteringWorker(
    context: Context,
    params: WorkerParameters,
) : CoroutineWorker(context, params) {

    override suspend fun doWork(): Result {
        // Run the 16-stage pipeline in background
        // Show a foreground notification with progress
        // Save result to Room + output file
        // Return Result.success() or Result.failure()
    }
}
```

### 9. PERMISSIONS

In `AndroidManifest.xml`:
```xml
<uses-permission android:name="android.permission.INTERNET" />
<uses-permission android:name="android.permission.READ_MEDIA_AUDIO" />
<uses-permission android:name="android.permission.POST_NOTIFICATIONS" />
<uses-permission android:name="android.permission.FOREGROUND_SERVICE" />
<uses-permission android:name="android.permission.FOREGROUND_SERVICE_DATA_SYNC" />
```

### 10. KEY IMPLEMENTATION NOTES

1. **All audio processing runs on Dispatchers.Default** (CPU-bound coroutines) — never block the main thread.

2. **Use MediaExtractor for decoding:**
   ```kotlin
   val extractor = MediaExtractor()
   extractor.setDataSource(context, uri, null)
   val format = extractor.getTrackFormat(0)
   val mime = format.getString(MediaFormat.KEY_MIME)
   val decoder = MediaCodec.createDecoderByType(mime)
   // ... decode to PCM FloatArray
   ```

3. **WAV encoding is manual** — write the RIFF header + PCM data directly to a file (same as the web app's encoder).

4. **LUFS measurement must follow ITU-R BS.1770-4 exactly:**
   - K-weighting: high-shelf filter (+4dB at high freqs) then high-pass (RLB) filter
   - Mean square of each channel
   - Sum across channels with weights: L=1.0, R=1.0, C=1.0, Ls=1.41, Rs=1.41
   - -0.691 + 10 * log10(mean square) = LUFS

5. **Ed25519 signing uses Java Security API:**
   ```kotlin
   val keyPair = KeyPairGenerator.getInstance("Ed25519").generateKeyPair()
   val signature = Signature.getInstance("Ed25519")
   signature.initSign(keyPair.private)
   signature.update(audioHashBytes)
   val sigBytes = signature.sign()
   ```

6. **Session persistence uses EncryptedSharedPreferences** to store the auth cookie safely.

7. **The AI Co-Master calls the backend API** — if the backend is unreachable, fall back to genre-aware heuristic macros (same as web app).

8. **LSB watermark:** Embed a 32-bit hash in the LSB of every 32nd sample (channel 0), same as the web app.

9. **Material Design 3 dynamic colors:** If the device supports it (Android 12+), use `dynamicColorScheme()` to adapt the accent color to the user's wallpaper — but keep the lime accent as fallback.

10. **Edge-to-edge:** Use `enableEdgeToEdge()` in the Activity and handle window insets in Compose.

### 11. BUILD CONFIGURATION

`build.gradle.kts (app)`:
```kotlin
android {
    namespace = "com.thatguyproductions.rainv6"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.thatguyproductions.rainv6"
        minSdk = 26
        targetSdk = 35
        versionCode = 1
        versionName = "0.2.1"
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }

    composeOptions {
        kotlinCompilerExtensionVersion = "1.5.15"
    }
}
```

### 12. WHAT TO BUILD FIRST (Priority Order)

If the AI can't build everything at once, build in this order:

1. **Theme + Navigation + Landing screen** (so the app launches and looks right)
2. **Audio decoder** (MediaExtractor → FloatArray)
3. **LUFS meter + true-peak meter** (the core DSP measurements)
4. **Biquad filter + multiband compressor + limiter** (the processing chain)
5. **Mastering pipeline** (wire stages together with progress callback)
6. **WAV encoder** (so you can export)
7. **Studio screen UI** (file upload, macro sliders, run button, progress)
8. **Room database + ViewModels**
9. **Auth screens + API client**
10. **Export screen + MP3 encoder**
11. **Provenance (Ed25519)**
12. **Free tools screens**
13. **Settings, What's New, polish**

### 13. APP ICON

Use a simple lime-green infinity symbol (∞) on a black background. Generate using the adaptive icon system:
- Background: solid `#0A0C10`
- Foreground: `∞` in `#AAFF00`, bold, centered

### 14. DON'T DO

- Don't use WebView to wrap the web app — build native.
- Don't use any cloud audio processing — everything is on-device.
- Don't fake the DSP — implement real filters, real measurements.
- Don't skip the metadata validation — title + artist required before export.
- Don't skip the auth gate — sign-in required before export.
- Don't use deprecated APIs (AudioTrack.write with short arrays, etc.) — use modern AudioTrack with FloatArray.
- Don't block the main thread — all audio processing in coroutines on Dispatchers.Default.

---

## GENERATE THE FULL PROJECT NOW

Start building from step 1. Create all files. Implement real DSP algorithms. Make it compile and run on a real Android device. The app should be production-ready for Play Store submission.

---

## NOTES FOR THE DEVELOPER

**Backend:** The Android app connects to the existing RAIN V6 backend API for:
- User authentication (register, login, logout)
- AI Co-Master suggestions (LLM-powered macros)
- Public stats and reviews

If the backend is unreachable, the app must still function fully for:
- Audio decoding, processing, and export (all on-device)
- Local session/render history (Room database)
- Genre-aware heuristic macro suggestions (fallback when AI is offline)

**Play Store Readiness:**
- Target SDK 35
- 64-bit support (no 32-bit-only native libs)
- Proper file provider for sharing exported audio
- Adaptive icon
- No dangerous permissions without justification
- Privacy policy URL (the app collects no personal data beyond auth)

**Testing:**
- Test on a real device with a real audio file
- Verify LUFS measurement matches a reference (e.g., -14 LUFS for Spotify target)
- Verify WAV export plays correctly in other apps
- Verify session persists across app restarts
