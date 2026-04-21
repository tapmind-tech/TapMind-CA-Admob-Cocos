#!/usr/bin/env python3
"""
Inject [TM] Prepare xcframework Artifacts script phase into pbxproj.
CocoaPods doesn't add xcframework copy steps for CMake-generated projects.
Usage: python3 inject_xcfw_phase.py <path/to/project.pbxproj>
"""
import plistlib, sys

SCRIPT_UUID = 'DE79D877F3C39F5B8F5003CA'

SHELL_SCRIPT = r'''set -e
PODS_DIR="${PODS_ROOT}"
BUILT_DIR="${BUILT_PRODUCTS_DIR}"
copy_xcframework() {
    local NAME="$1"; local XCFW_PATH="$2"
    [ ! -d "$XCFW_PATH" ] && return
    local SLICE=""
    if [ "$PLATFORM_NAME" = "iphonesimulator" ]; then
        SLICE=$(find "$XCFW_PATH" -maxdepth 1 -name "*simulator*" -type d | head -1)
    else
        SLICE=$(find "$XCFW_PATH" -maxdepth 1 -name "ios-arm64" -type d | head -1)
    fi
    [ -z "$SLICE" ] && return
    local FW_PATH=$(find "$SLICE" -name "*.framework" -type d | head -1)
    [ -n "$FW_PATH" ] && rsync -av "$FW_PATH" "$BUILT_DIR/" 2>/dev/null || true
}
copy_xcframework "GoogleMobileAds" "$PODS_DIR/Google-Mobile-Ads-SDK/Frameworks/GoogleMobileAdsFramework/GoogleMobileAds.xcframework"
copy_xcframework "UserMessagingPlatform" "$PODS_DIR/GoogleUserMessagingPlatform/Frameworks/Release/UserMessagingPlatform.xcframework"
for XCF in "$PODS_DIR/TapMindSDK/"*.xcframework "$PODS_DIR/TapMindAdapter/"*.xcframework; do
    [ -d "$XCF" ] && copy_xcframework "$(basename "$XCF" .xcframework)" "$XCF"
done
echo "xcframework artifacts prepared."
'''


def main():
    if len(sys.argv) < 2:
        print("Usage: python3 inject_xcfw_phase.py <path/to/project.pbxproj>", file=sys.stderr)
        sys.exit(1)

    pbx_path = sys.argv[1]

    with open(pbx_path, 'rb') as f:
        data = plistlib.load(f)

    objects = data['objects']

    # Check if already injected — skip phase injection but still do cleanup
    phase_already_present = SCRIPT_UUID in objects

    # Create the script phase (only if not already injected)
    if not phase_already_present:
        objects[SCRIPT_UUID] = {
            'isa': 'PBXShellScriptBuildPhase',
            'buildActionMask': '2147483647',
            'files': [],
            'inputPaths': [],
            'name': '[TM] Prepare xcframework Artifacts',
            'outputPaths': [],
            'runOnlyForDeploymentPostprocessing': '0',
            'shellPath': '/bin/sh',
            'shellScript': SHELL_SCRIPT,
            'showEnvVarsInLog': '0',
        }

        # Add to the mobile target's buildPhases, before the link phase
        for uid, obj in objects.items():
            if obj.get('isa') == 'PBXNativeTarget' and 'mobile' in obj.get('name', ''):
                phases = obj['buildPhases']
                if SCRIPT_UUID not in phases:
                    fw_idx = next(
                        (i for i, pid in enumerate(phases)
                         if objects[pid].get('isa') == 'PBXFrameworksBuildPhase'),
                        len(phases)
                    )
                    phases.insert(fw_idx, SCRIPT_UUID)
        print("Injected [TM] Prepare xcframework Artifacts phase.", file=sys.stderr)

    # Remove hardcoded xcframework slice paths from FRAMEWORK_SEARCH_PATHS
    # Cocos CMake adds ios-arm64 (device) paths which break simulator builds.
    # CocoaPods' XCFrameworkIntermediates handles the correct arch automatically.
    removed = 0
    for uid, obj in objects.items():
        bs = obj.get('buildSettings', {})
        fsp = bs.get('FRAMEWORK_SEARCH_PATHS')
        if isinstance(fsp, list):
            original_len = len(fsp)
            bs['FRAMEWORK_SEARCH_PATHS'] = [
                p for p in fsp if '.xcframework/' not in str(p)
            ]
            removed += original_len - len(bs['FRAMEWORK_SEARCH_PATHS'])
    if removed:
        print(f"Removed {removed} hardcoded xcframework slice paths.", file=sys.stderr)

    # Remove direct Pod binary paths from OTHER_LDFLAGS
    # These cause duplicate symbols because CocoaPods also links them via xcconfig
    ld_removed = 0
    for uid, obj in objects.items():
        bs = obj.get('buildSettings', {})
        ldflags = bs.get('OTHER_LDFLAGS')
        if isinstance(ldflags, list):
            original_len = len(ldflags)
            bs['OTHER_LDFLAGS'] = [
                p for p in ldflags if '/Pods/' not in str(p)
            ]
            ld_removed += original_len - len(bs['OTHER_LDFLAGS'])
    if ld_removed:
        print(f"Removed {ld_removed} direct Pod paths from OTHER_LDFLAGS (fixes duplicate symbols).", file=sys.stderr)

    with open(pbx_path, 'wb') as f:
        plistlib.dump(data, f, sort_keys=False)

    print("pbxproj cleanup complete.", file=sys.stderr)


if __name__ == '__main__':
    main()
