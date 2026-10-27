# esbuild portable launcher

`esbuild-0.28.1-bin.txt` is the unmodified `package/bin/esbuild` from the official npm `esbuild@0.28.1` tarball. Its MIT license is preserved in `esbuild-LICENSE.md`. The materializer restores this portable JavaScript launcher because esbuild's macOS postinstall replaces it with a Mach-O executable, which breaks the Windows postinstall version check. This file is only a build input; the restored launcher ships inside the bundled esbuild dependency.
