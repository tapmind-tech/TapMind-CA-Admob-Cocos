# TapMind AdMob mediator — Cocos Creator 3.8 extension

This package is the **mediator layer for AdMob** in TapMind games: it is a Cocos Creator extension that wires the **TapMind AdMob adapter** (custom mediation adapter) and **Google Mobile Ads** into your Android and iOS native projects during the build pipeline. You add the extension once; native Gradle and CocoaPods configuration are applied automatically.

---

## What the mediator package does

The adapter (`customadapter-admob` on Android, `TapMindAdapter` on iOS) sits between your app and AdMob’s SDK so TapMind’s stack can serve and coordinate ads consistently. This extension does **not** add a JavaScript/TypeScript API — it only **injects and links** the native SDKs and required settings.

| Platform | What gets applied |
|----------|-------------------|
| **Android** | `io.github.tapmind-tech:customadapter-admob` from **Maven Central** |
| **Android** | `com.google.android.gms:play-services-ads` (Google Mobile Ads) |
| **Android** | `androidx.javascriptengine:javascriptengine` (required for AdMob 23.x fullscreen ads) |
| **Android** | `minSdkVersion` / `compileSdkVersion` / `targetSdkVersion` raised when needed (min **26**, target **36**); `gradle.properties` `PROP_MIN_SDK_VERSION` aligned |
| **iOS** | `Podfile` with `Google-Mobile-Ads-SDK`, `TapMindAdapter`, `libwebp`; deployment target **18.0** |
| **iOS** | Runs `pod install` when possible; patches project for Xcode 26 / linker / xcframework prep |
| **iOS** | Injects `GADApplicationIdentifier` (and SKAdNetwork stub) into generated `Info.plist` files under `CMakeFiles` |

> **No separate API key in this repo** — AdMob app ID is embedded in the hook for the generated iOS plist (must match your game’s AdManager configuration).

---

## Installation

### Step 1 — Add the extension to your Cocos project

```
YourCocosProject/
└── extensions/
    └── tapmind_ads_admob/   ← this repository / folder
        ├── package.json
        ├── source/
        │   └── main.js
        └── hooks/
            └── builder-hooks.js
```

### Step 2 — Enable the extension

1. Open your Cocos Creator 3.8+ project.
2. **Extensions → Extension Manager → Project**.
3. Enable **tapmind_ads_admob**.

You should see:

```
[TapMind Native Ads] Extension loaded successfully.
[TapMind Native Ads] Build hooks registered. Android & iOS SDKs will be injected automatically on every build.
```

### Step 3 — Build

- **Android**: Project → Build → Android.
- **iOS**: Project → Build → iOS.

The hook runs after the native project is generated. Watch the build log for lines starting with `[TapMind Native Ads]`.

---

## Android — after build

1. Open the Android project (e.g. under `native/engine/android/` or your build output if patched there) in **Android Studio**.
2. **Sync Gradle**.
3. Build and run.

The TapMind adapter is on **Maven Central** (`io.github.tapmind-tech`) — no custom Maven URL or GitHub token is required.

---

## iOS — after build

1. Open the **`.xcworkspace`** under `build/<output>/proj/` (not the `.xcodeproj` alone).
2. If `pod install` did not finish in the hook, run:
   ```bash
   cd path/to/build/<output>/proj
   pod install
   ```
3. Build in Xcode.

The extension may generate/overwrite the `Podfile`, run `pod install`, adjust `project.pbxproj` (XML plist, `-ld_classic`, `EXCLUDED_ARCHS`, xcframework prepare phase). If something fails, the log will say to run `pod install` manually.

---

## Injected snippets (reference)

### Android — project `build.gradle` / `settings.gradle`

```gradle
// [TapMind Native Ads] Maven Central (TapMind adapter)
mavenCentral()
```

### Android — `app/build.gradle` (typical)

```gradle
minSdkVersion 26
targetSdkVersion 36
// ...
// [TapMind] Google Mobile Ads SDK
    implementation 'com.google.android.gms:play-services-ads:25.4.0'
// [TapMind] TapMind AdMob adapter
    implementation 'io.github.tapmind-tech:customadapter-admob:2.1.14'
// [TapMind] Jetpack JavaScriptEngine
    implementation 'androidx.javascriptengine:javascriptengine:1.0.0-beta01'
```

### iOS — `Podfile` (generated)

- `platform :ios, '18.0'`
- `pod 'Google-Mobile-Ads-SDK'`
- `pod 'TapMindAdapter'`
- `pod 'libwebp'`

---

## Idempotency

Android injections skip duplicate repository and dependency lines when already present. iOS regenerates the `Podfile` for the detected target; treat the hook as authoritative for that file after a build.

---

## Troubleshooting

| Issue | What to try |
|-------|-------------|
| No `build.gradle` / Gradle errors | Run a full Android build so `native/engine/android` (or build output) exists. |
| No `Podfile` / iOS errors | Run a full iOS build first; ensure CocoaPods is installed if auto `pod install` fails. |
| Gradle 401 on Maven | Adapter is on Maven Central — check proxy/VPN; credentials should not be required. |
| Extension not in Extension Manager | Folder must live under project `extensions/`, not under `assets/`. |

---

## Compatibility

| Requirement | Version |
|-------------|---------|
| Cocos Creator | ≥ 3.8.0 |
| Android minSdk (after hook) | 26 |
| Android target/compile SDK | 36 |
| iOS deployment target | 18.0 |
| Node.js | Bundled with Cocos Creator (≥ 16 typical) |

---

## License

MIT © TapMind Tech
