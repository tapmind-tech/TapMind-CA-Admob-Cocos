'use strict';

/**
 * TapMind Native Ads — Builder Hooks
 * ===================================
 * Registered in package.json under contributions.builder.hooks.
 * Cocos Creator 3.8 calls these hooks automatically during the build pipeline.
 *
 * Hooks fired:
 *   onBeforeBuild      – log / validate
 *   onAfterBuild       – inject into generated native project files
 */

const fs   = require('fs');
const path = require('path');
const { execSync } = require('child_process');


// ─── Constants ────────────────────────────────────────────────────────────────

/** AdMob App ID — must match the ID in AdManager.ts */
const ADMOB_APP_ID = 'ca-app-pub-2967653914154128~9624426349';

/** Gradle dependency string for Google Mobile Ads SDK */
const ANDROID_ADMOB_DEPENDENCY =
    "    implementation 'com.google.android.gms:play-services-ads:25.4.0'";

/** Gradle dependency string for the TapMind AdMob adapter */
const ANDROID_DEPENDENCY =
    "    implementation 'io.github.tapmind-tech:customadapter-admob:2.1.14'";

/** Gradle dependency for Jetpack JavaScriptEngine — required by AdMob 23.x for full-screen ads */
const ANDROID_JSENGINE_DEPENDENCY =
    "    implementation 'androidx.javascriptengine:javascriptengine:1.0.0-beta01'";

/** Android SDK version requirements */
const ANDROID_MIN_SDK    = 26;  // androidx.javascriptengine requires API 26+
const ANDROID_TARGET_SDK = 36;

/** iOS deployment target */
const IOS_DEPLOYMENT_TARGET = '18.0';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Safely read a file as UTF-8 text. Returns null if the file does not exist.
 */
function readFileSafe(filePath) {
    if (!fs.existsSync(filePath)) return null;
    return fs.readFileSync(filePath, 'utf8');
}

/**
 * Overwrite a file with new content. Creates parent dirs if needed.
 */
function writeFile(filePath, content) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content, 'utf8');
}

/**
 * Find files OR directories matching a pattern in a directory (one level deep).
 */
function findEntries(dir, pattern) {
    const results = [];
    if (!fs.existsSync(dir)) return results;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
        if (entry.name.match(pattern)) {
            results.push(path.join(dir, entry.name));
        }
    }
    return results;
}

/**
 * Find files matching a pattern recursively.
 */
function findFiles(dir, pattern) {
    const results = [];
    function walk(d) {
        if (!fs.existsSync(d)) return;
        const entries = fs.readdirSync(d, { withFileTypes: true });
        for (const entry of entries) {
            const fullPath = path.join(d, entry.name);
            if (entry.isDirectory()) {
                walk(fullPath);
            } else if (entry.name.match(pattern)) {
                results.push(fullPath);
            }
        }
    }
    walk(dir);
    return results;
}

// ─── Android Injection ────────────────────────────────────────────────────────

function patchGradleProperties(androidProjRoot) {
    const gradlePropsPath = path.join(androidProjRoot, 'gradle.properties');
    let content = readFileSafe(gradlePropsPath);
    if (content === null) {
        console.warn(`[TapMind Native Ads] WARNING: gradle.properties not found at: ${gradlePropsPath}`);
        return;
    }

    const currentMatch = /PROP_MIN_SDK_VERSION=(\d+)/.exec(content);
    const current = currentMatch ? parseInt(currentMatch[1], 10) : 0;

    if (current < ANDROID_MIN_SDK) {
        content = content.replace(
            /PROP_MIN_SDK_VERSION=\d+/,
            `PROP_MIN_SDK_VERSION=${ANDROID_MIN_SDK} # [TapMind] elevated from ${current}`
        );
        writeFile(gradlePropsPath, content);
        console.log(`[TapMind Native Ads] ✓ PROP_MIN_SDK_VERSION updated: ${current} → ${ANDROID_MIN_SDK}`);
    }
}

/**
 * Ensure mavenCentral() is present in a Gradle repositories block.
 * TapMind customadapter-admob is published on Maven Central (io.github.tapmind-tech).
 */
function ensureMavenCentralInGradle(gradleContent, repositoriesBlockRegex) {
    if (!gradleContent || gradleContent.includes('mavenCentral()')) {
        return gradleContent;
    }
    const snippet = `\n        // [TapMind Native Ads] Maven Central (TapMind adapter)\n        mavenCentral()`;
    const match = repositoriesBlockRegex.exec(gradleContent);
    if (!match) return gradleContent;

    const repoStart = match.index + match[0].length;
    let depth = 1, i = repoStart;
    while (i < gradleContent.length && depth > 0) {
        if (gradleContent[i] === '{') depth++;
        else if (gradleContent[i] === '}') depth--;
        i++;
    }
    const insertPos = i - 1;
    return gradleContent.slice(0, insertPos) + snippet + '\n    ' + gradleContent.slice(insertPos);
}

function injectAndroid(androidProjRoot) {
    console.log('[TapMind Native Ads] Injecting Android configuration...');

    patchGradleProperties(androidProjRoot);

    // ── Ensure Maven Central (TapMind adapter host) ─────────────────────
    const projectGradlePath = path.join(androidProjRoot, 'build.gradle');
    let projectGradle = readFileSafe(projectGradlePath);

    if (projectGradle) {
        const updated = ensureMavenCentralInGradle(
            projectGradle,
            /allprojects\s*\{[^}]*repositories\s*\{/s
        );
        if (updated !== projectGradle) {
            writeFile(projectGradlePath, updated);
            console.log('[TapMind Native Ads] ✓ mavenCentral() added to project build.gradle');
        }
    }

    const settingsGradlePath = path.join(androidProjRoot, 'settings.gradle');
    let settingsGradle = readFileSafe(settingsGradlePath);
    if (settingsGradle) {
        const updated = ensureMavenCentralInGradle(
            settingsGradle,
            /dependencyResolutionManagement\s*\{[^}]*repositories\s*\{/s
        );
        if (updated !== settingsGradle) {
            writeFile(settingsGradlePath, updated);
            console.log('[TapMind Native Ads] ✓ mavenCentral() added to settings.gradle');
        }
    }

    // ── App-level build.gradle ──────────────────────────────────────────
    const appGradlePath = path.join(androidProjRoot, 'app', 'build.gradle');
    let appGradle = readFileSafe(appGradlePath);
    if (appGradle === null) return;

    let modified = false;

    // minSdkVersion
    const minSdkRegex = /minSdkVersion\s+(\d+)/;
    const minSdkMatch = minSdkRegex.exec(appGradle);
    if (minSdkMatch && parseInt(minSdkMatch[1], 10) < ANDROID_MIN_SDK) {
        appGradle = appGradle.replace(minSdkRegex, `minSdkVersion ${ANDROID_MIN_SDK}`);
        modified = true;
    }

    // targetSdkVersion
    const targetSdkRegex = /targetSdkVersion\s+(\d+)/;
    const targetSdkMatch = targetSdkRegex.exec(appGradle);
    if (targetSdkMatch && parseInt(targetSdkMatch[1], 10) < ANDROID_TARGET_SDK) {
        appGradle = appGradle.replace(targetSdkRegex, `targetSdkVersion ${ANDROID_TARGET_SDK}`);
        modified = true;
    }

    // compileSdkVersion
    const compileSdkRegex = /compileSdkVersion\s+(\d+)/;
    const compileSdkMatch = compileSdkRegex.exec(appGradle);
    if (compileSdkMatch && parseInt(compileSdkMatch[1], 10) < ANDROID_TARGET_SDK) {
        appGradle = appGradle.replace(compileSdkRegex, `compileSdkVersion ${ANDROID_TARGET_SDK}`);
        modified = true;
    }

    // Dependencies
    function injectDep(gradle, depLine, label) {
        if (gradle.includes(depLine.trim())) return gradle;
        const depsMatch = /dependencies\s*\{/s.exec(gradle);
        if (depsMatch) {
            const depsStart = depsMatch.index + depsMatch[0].length;
            let depth = 1, i = depsStart;
            while (i < gradle.length && depth > 0) {
                if (gradle[i] === '{') depth++;
                else if (gradle[i] === '}') depth--;
                i++;
            }
            const insertPos = i - 1;
            gradle = gradle.slice(0, insertPos) + `\n    // [TapMind] ${label}\n${depLine}\n` + gradle.slice(insertPos);
            modified = true;
            console.log(`[TapMind Native Ads] ✓ Injected: ${label}`);
        }
        return gradle;
    }

    if (!appGradle.includes('play-services-ads')) {
        appGradle = injectDep(appGradle, ANDROID_ADMOB_DEPENDENCY, 'Google Mobile Ads SDK');
    }
    if (!appGradle.includes('customadapter-admob')) {
        appGradle = injectDep(appGradle, ANDROID_DEPENDENCY, 'TapMind AdMob adapter');
    }
    if (!appGradle.includes('javascriptengine')) {
        appGradle = injectDep(appGradle, ANDROID_JSENGINE_DEPENDENCY, 'Jetpack JavaScriptEngine');
    }

    if (modified) writeFile(appGradlePath, appGradle);
    console.log('[TapMind Native Ads] ✓ Android injection complete.');
}

// ─── iOS Injection (FULLY AUTOMATED) ─────────────────────────────────────────

function injectIOS(iosProjRoot, options) {
    console.log('[TapMind Native Ads] Injecting iOS configuration...');

    // ── 1. Find project name from .xcodeproj (it's a directory, not a file) ──
    const xcodeprojs = findEntries(iosProjRoot, /\.xcodeproj$/);
    if (xcodeprojs.length === 0) {
        console.warn('[TapMind Native Ads] WARNING: No .xcodeproj found. Skipping iOS injection.');
        return;
    }
    const xcodeprojPath = xcodeprojs[0];
    const projectName = path.basename(xcodeprojPath, '.xcodeproj');
    const targetName = projectName + '-mobile';
    console.log(`[TapMind Native Ads] Found project: ${projectName}`);

    // ── 2. Generate Podfile ───────────────────────────────────────────────
    const podfilePath = path.join(iosProjRoot, 'Podfile');
    const podfileContent = `platform :ios, '${IOS_DEPLOYMENT_TARGET}'
ENV['COCOAPODS_DISABLE_STATS'] = 'true'

target '${targetName}' do
  use_frameworks! :linkage => :static
  pod 'Google-Mobile-Ads-SDK'
  pod 'TapMindAdapter'
  pod 'libwebp'
end

post_install do |installer|
  installer.pods_project.targets.each do |target|
    target.build_configurations.each do |config|
      config.build_settings['IPHONEOS_DEPLOYMENT_TARGET'] = '${IOS_DEPLOYMENT_TARGET}'
    end
  end
end
`;
    writeFile(podfilePath, podfileContent);
    console.log('[TapMind Native Ads] ✓ Podfile generated');

    // ── 3. Run pod install ────────────────────────────────────────────────
    try {
        // Find pod binary — location differs on Intel vs Apple Silicon Macs
        const podCandidates = [
            '/opt/homebrew/bin/pod',   // Apple Silicon (Homebrew)
            '/usr/local/bin/pod',      // Intel Mac (Homebrew)
            `${process.env.HOME}/.rbenv/shims/pod`,
            `${process.env.HOME}/.rvm/bin/pod`,
        ];
        const podBin = podCandidates.find(p => fs.existsSync(p)) || 'pod';
        console.log(`[TapMind Native Ads] Running pod install (${podBin})...`);
        execSync(`${podBin} install`, {
            cwd: iosProjRoot,
            stdio: 'pipe',
            timeout: 180000,
            env: { ...process.env, LANG: 'en_US.UTF-8', LC_ALL: 'en_US.UTF-8' }
        });
        console.log('[TapMind Native Ads] ✓ pod install completed');
    } catch (err) {
        console.warn('[TapMind Native Ads] WARNING: pod install failed. Run manually:');
        console.warn(`  cd ${iosProjRoot} && pod install`);
        console.warn(err.stderr ? err.stderr.toString() : err.message);
    }

    // ── 5. Convert pbxproj from old-style plist to XML plist (Xcode 26 compat) ──
    const pbxprojPath = path.join(xcodeprojPath, 'project.pbxproj');
    const pbxprojContent = readFileSafe(pbxprojPath);
    if (pbxprojContent && !pbxprojContent.trim().startsWith('<?xml')) {
        console.log('[TapMind Native Ads] Converting pbxproj to XML plist (Xcode 26 compatibility)...');
        const fixScript = path.join(__dirname, 'fix_pbxproj.py');
        try {
            const { execSync } = require('child_process');
            execSync(`python3 "${fixScript}" "${pbxprojPath}"`, { stdio: 'inherit' });
            console.log('[TapMind Native Ads] ✓ pbxproj converted to XML plist');
        } catch (e) {
            console.warn('[TapMind Native Ads] ⚠ pbxproj conversion failed:', e.message);
            // Fallback: at minimum fix the quad-quote corruption
            if (pbxprojContent.includes('""""')) {
                writeFile(pbxprojPath, pbxprojContent.split('""""').join('""'));
                console.log('[TapMind Native Ads] ✓ Applied quad-quote fallback fix');
            }
        }
    } else if (pbxprojContent) {
        console.log('[TapMind Native Ads] ✓ pbxproj already in XML format');
    }

    // ── 5b. Strip -ld_classic from pbxproj (crashes Xcode 26 linker) ─────────
    let pbxFinal = readFileSafe(pbxprojPath);
    if (pbxFinal && pbxFinal.includes('ld_classic')) {
        // Line-based removal works for both old-style and XML plist formats
        const filtered = pbxFinal.split('\n').filter(l => !l.includes('ld_classic'));
        writeFile(pbxprojPath, filtered.join('\n'));
        console.log('[TapMind Native Ads] ✓ Stripped -ld_classic (Xcode 26 linker fix)');
    }

    // ── 5c. Clear EXCLUDED_ARCHS (Cocos excludes all simulator archs) ────────
    let pbxArchs = readFileSafe(pbxprojPath);
    if (pbxArchs && pbxArchs.includes('EXCLUDED_ARCHS')) {
        // Handle old-style plist: EXCLUDED_ARCHS = "arm64 x86_64";
        pbxArchs = pbxArchs.replace(/("EXCLUDED_ARCHS\[sdk=iphonesimulator\*\]"\s*=\s*)"[^"]*"/g, '$1""');
        pbxArchs = pbxArchs.replace(/("EXCLUDED_ARCHS\[sdk=iphonesimulator\*\]"\s*=\s*)arm64;/g, '$1"";');
        // Handle XML plist: <key>EXCLUDED_ARCHS...</key>\n<string>arm64 x86_64</string>
        pbxArchs = pbxArchs.replace(
            /(<key>EXCLUDED_ARCHS\[sdk=iphonesimulator\*\]<\/key>\s*<string>)[^<]*(<\/string>)/g,
            '$1$2'
        );
        writeFile(pbxprojPath, pbxArchs);
        console.log('[TapMind Native Ads] ✓ Cleared EXCLUDED_ARCHS');
    }

    // ── 5d. Inject [TM] Prepare xcframework Artifacts script phase ───────────
    // CocoaPods doesn't add xcframework copy steps for CMake projects.
    // Without this, the linker can't find GoogleMobileAds symbols.
    let pbxForPhase = readFileSafe(pbxprojPath);
    if (pbxForPhase && !pbxForPhase.includes('Prepare xcframework Artifacts')) {
        const injectPhaseScript = path.join(__dirname, 'inject_xcfw_phase.py');
        try {
            execSync(`python3 "${injectPhaseScript}" "${pbxprojPath}"`, { stdio: 'inherit' });
            console.log('[TapMind Native Ads] ✓ Injected xcframework Prepare Artifacts phase');
        } catch (e) {
            console.warn('[TapMind Native Ads] ⚠ Failed to inject script phase:', e.message);
        }
    }

        // ── 6. Patch Info.plist with GADApplicationIdentifier ─────────────────
    const plistFiles = findFiles(path.join(iosProjRoot, 'CMakeFiles'), /Info\.plist$/);
    for (const plistPath of plistFiles) {
        let plist = readFileSafe(plistPath);
        if (plist && !plist.includes('GADApplicationIdentifier')) {
            plist = plist.replace(
                '</dict>\n</plist>',
                `\t<key>GADApplicationIdentifier</key>\n\t<string>${ADMOB_APP_ID}</string>\n\t<key>SKAdNetworkItems</key>\n\t<array>\n\t\t<dict>\n\t\t\t<key>SKAdNetworkIdentifier</key>\n\t\t\t<string>cstr6suwn9.skadnetwork</string>\n\t\t</dict>\n\t</array>\n</dict>\n</plist>`
            );
            writeFile(plistPath, plist);
            console.log(`[TapMind Native Ads] ✓ GADApplicationIdentifier injected into ${path.basename(plistPath)}`);
        }
    }

    console.log('[TapMind Native Ads] ✓ iOS injection complete.');
    console.log(`[TapMind Native Ads] Open in Xcode: open ${projectName}.xcworkspace`);
}

// ─── Build Hook Exports ───────────────────────────────────────────────────────

function resolveProjRoots(options) {
    // __dirname = /project/extensions/tapmind_ads_admob/hooks
    const projectRoot = path.join(__dirname, '..', '..', '..');
    const outputFolder = options.outputName || options.taskName || options.platform || '';
    const buildBase   = path.join(projectRoot, 'build', outputFolder);
    const projDir     = path.join(buildBase, 'proj');

    // For Android, Cocos Creator 3.8 uses native/engine/android/ as the project root.
    // The build output at build/<name>/proj/ may not contain build.gradle files.
    const nativeAndroid = path.join(projectRoot, 'native', 'engine', 'android');

    return { android: nativeAndroid, androidBuild: projDir, ios: projDir, projectRoot };
}

async function runInjection(options) {
    const { platform } = options;
    const roots = resolveProjRoots(options);
    console.log('[TapMind Native Ads] Build finished — starting SDK injection...');
    try {
        if (platform === 'android') {
            // Inject into native/engine/android/ (the actual project template)
            console.log(`[TapMind Native Ads] Android project root: ${roots.android}`);
            injectAndroid(roots.android);
            // Also try injecting into the build output dir if it has gradle files
            const buildGradle = path.join(roots.androidBuild, 'app', 'build.gradle');
            if (fs.existsSync(buildGradle)) {
                console.log(`[TapMind Native Ads] Also patching build output: ${roots.androidBuild}`);
                injectAndroid(roots.androidBuild);
            }
        } else if (platform === 'ios') {
            injectIOS(roots.ios, options);
        } else {
            console.log(`[TapMind Native Ads] Platform "${platform}" is not a native target; skipping.`);
        }
    } catch (err) {
        console.error('[TapMind Native Ads] ERROR during SDK injection:', err);
    }
    console.log('[TapMind Native Ads] SDK injection complete.');
}

// Cocos Creator 3.8: reads `configs` for platform setup, calls hooks at top level
module.exports = {
    configs: {
        '*': {
            hooks: __filename,
        },
    },

    async onBeforeBuild(options) {
        console.log('[TapMind Native Ads] Build detected — SDK injection queued.');
        console.log(`[TapMind Native Ads] Platform: ${options.platform}`);
    },

    async onAfterBuild(options) {
        await runInjection(options);
    },
};
