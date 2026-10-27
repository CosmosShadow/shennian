#!/bin/sh
# @arch docs/design/brand/assets/README.md
# @test packages/app/src/__tests__/app-config.test.ts
set -eu
APP_ROOT="${1:-$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)}"
NATIVE_PROJECT="${2:-}"
if [ -z "$NATIVE_PROJECT" ]; then
  # Existing projects can retain the old app name; fresh prebuild uses the app name.
  for project in "$APP_ROOT"/ios/*.xcodeproj; do
    [ -d "$project" ] || continue
    NATIVE_PROJECT="${project##*/}"
    NATIVE_PROJECT="${NATIVE_PROJECT%.xcodeproj}"
    break
  done
fi
NATIVE_ROOT="$APP_ROOT/ios/${NATIVE_PROJECT:-app}"
CATALOG="$NATIVE_ROOT/Images.xcassets/AppIcon.appiconset"
# Match Expo's .icon destination for existing Xcode projects.
if [ -d "$NATIVE_ROOT" ]; then
  mkdir -p "$NATIVE_ROOT/Shennian.icon/Assets"
  for file in icon.json Assets/Logo.svg; do
    if ! cmp -s "$APP_ROOT/assets/Shennian.icon/$file" "$NATIVE_ROOT/Shennian.icon/$file"; then
      cp "$APP_ROOT/assets/Shennian.icon/$file" "$NATIVE_ROOT/Shennian.icon/$file"
    fi
  done
fi
# A fresh checkout has no native project yet; Expo prebuild creates this catalog.
[ -d "$CATALOG" ] || exit 0
for variant in light dark tinted; do
  case "$variant" in
    light) source=icon.png; target=App-Icon-1024x1024@1x.png ;;
    dark) source=icon-dark.png; target=App-Icon-dark-1024x1024@1x.png ;;
    tinted) source=icon-tinted.png; target=App-Icon-tinted-1024x1024@1x.png ;;
  esac
  # Fail the build on missing inputs rather than silently shipping stale artwork.
  test -f "$APP_ROOT/assets/$source"
  if ! cmp -s "$APP_ROOT/assets/$source" "$CATALOG/$target"; then
    cp "$APP_ROOT/assets/$source" "$CATALOG/$target"
  fi
done
