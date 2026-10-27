#!/bin/sh
# 神念安装器（macOS / Linux）
#
#   curl -fsSL https://shennian.net/install.sh | sh
#
# 可以反复运行：已装好的部分会跳过。它会：
#   1. 使用本机 Node 22.19+；没有时下载一份只给神念用的 Node（不改动系统）
#   2. 安装或升级神念 Client（国内网络自动使用 npmmirror 镜像）
#   3. 运行 `shennian setup`：安装 Skill、发现本机 AI、给出配对链接、启动后台服务
#
# 传给本脚本的参数会原样交给 `shennian setup`，例如：
#   curl -fsSL https://shennian.net/install.sh | sh -s -- --json
#
# 可选环境变量：SHENNIAN_HOME、SHENNIAN_NPM_REGISTRY、SHENNIAN_NODE_MIRROR、
# SHENNIAN_OSS_NODE_MIRROR、SHENNIAN_CLI_PACKAGE（默认 shennian@latest；预览版用 shennian@next）
# 设计说明：docs/architecture/cli/setup.md
set -eu

SHENNIAN_HOME="${SHENNIAN_HOME:-$HOME/.shennian}"
RUNTIME_DIR="$SHENNIAN_HOME/runtime/node"
CLI_PREFIX="$SHENNIAN_HOME/cli"
BIN_DIR="$SHENNIAN_HOME/bin"
CLI_PACKAGE="${SHENNIAN_CLI_PACKAGE:-shennian@latest}"
NODE_MAJOR=24
REGISTRY_OFFICIAL="https://registry.npmjs.org"
REGISTRY_CN="https://registry.npmmirror.com"
NODE_DIST_OFFICIAL="https://nodejs.org/dist"
NODE_DIST_CN="https://npmmirror.com/mirrors/node"
# Our own mirror of the exact official Node binaries (see scripts/cache-node-runtime-to-oss.mjs);
# tried first since it is typically far faster and more reliable than nodejs.org or npmmirror.
OSS_NODE_MIRROR="${SHENNIAN_OSS_NODE_MIRROR:-https://videoindustry.oss-cn-hangzhou.aliyuncs.com/shennian/toolchain/node}"

say() { printf '%s\n' "$*"; }
step() { printf '\n==> %s\n' "$*"; }
fail() {
  printf '\n✗ %s\n' "$*" >&2
  printf '  需要帮助：把上面的输出发给你的 AI，或到神念官方群找客服（https://shennian.net/#contact）。\n' >&2
  exit 1
}

have() { command -v "$1" >/dev/null 2>&1; }

download() { # url dest [max-seconds]
  max="${3:-25}"
  # --connect-timeout alone does not bound a stalled transfer after the connection opens.
  if have curl; then curl -fsSL --retry 2 --connect-timeout 10 --max-time "$max" -o "$2" "$1"
  elif have wget; then wget -q -T "$max" -O "$2" "$1"
  else fail "需要 curl 或 wget 才能下载。"
  fi
}

reachable() { # url
  if have curl; then curl -fsS -o /dev/null --max-time 4 "$1" 2>/dev/null
  else wget -q -O /dev/null -T 4 "$1" 2>/dev/null
  fi
}

node_compatible() { # node-path; Pi SDK requires >=22.19.0
  "$1" -e 'const [major, minor] = process.versions.node.split(".").map(Number); process.exit(major > 22 || (major === 22 && minor >= 19) ? 0 : 1)' 2>/dev/null
}

sha256_of() {
  if have sha256sum; then sha256sum "$1" | cut -d' ' -f1
  elif have shasum; then shasum -a 256 "$1" | cut -d' ' -f1
  else fail "需要 sha256sum 或 shasum 来校验下载的 Node。"
  fi
}

# ── 0. 环境 ──────────────────────────────────────────────────────────────────
case "$(uname -s)" in
  Darwin) OS=darwin ;;
  Linux) OS=linux ;;
  *) fail "这个脚本只支持 macOS 和 Linux；Windows 请在 PowerShell 运行：irm https://shennian.net/install.ps1 | iex" ;;
esac
case "$(uname -m)" in
  x86_64|amd64) ARCH=x64 ;;
  arm64|aarch64) ARCH=arm64 ;;
  *) ARCH="" ;;
esac

if ! mkdir -p "$SHENNIAN_HOME" 2>/dev/null || ! [ -w "$SHENNIAN_HOME" ]; then
  fail "无法写入 $SHENNIAN_HOME。如果是 AI 在帮你安装，它可能运行在沙盒里：请给它开启完整权限，或者自己打开终端粘贴这一行安装命令。"
fi
chmod 700 "$SHENNIAN_HOME" 2>/dev/null || true

step "检查网络"
if [ -n "${SHENNIAN_NPM_REGISTRY:-}" ]; then
  REGISTRY="$SHENNIAN_NPM_REGISTRY"; REGISTRY_ALT="$REGISTRY_OFFICIAL"
  NODE_DIST="${SHENNIAN_NODE_MIRROR:-$NODE_DIST_OFFICIAL}"
elif reachable "$REGISTRY_OFFICIAL/-/ping"; then
  REGISTRY="$REGISTRY_OFFICIAL"; REGISTRY_ALT="$REGISTRY_CN"
  NODE_DIST="${SHENNIAN_NODE_MIRROR:-$NODE_DIST_OFFICIAL}"
  say "使用 npm 官方源"
else
  REGISTRY="$REGISTRY_CN"; REGISTRY_ALT="$REGISTRY_OFFICIAL"
  NODE_DIST="${SHENNIAN_NODE_MIRROR:-$NODE_DIST_CN}"
  say "使用国内镜像 npmmirror"
fi

# ── 1. Node ───────────────────────────────────────────────────────────────────
install_private_node() {
  [ -n "$ARCH" ] || fail "这台电脑的 CPU 架构（$(uname -m)）没有现成的 Node 安装包。请先用系统的包管理器安装 Node.js 22.19 或更高版本，再重新运行。"
  if [ "$OS" = linux ] && [ -f /etc/alpine-release ]; then
    fail "Alpine Linux 需要先用 apk add nodejs npm 安装 Node.js 22.19 或更高版本，再重新运行。"
  fi
  step "下载神念专用的 Node（放在 $RUNTIME_DIR，不改动系统）"
  tmp="$(mktemp -d "${TMPDIR:-/tmp}/shennian-node.XXXXXX")"
  trap 'rm -rf "$tmp"' EXIT

  file="" sum="" version=""
  # Our own mirror first: one small pointer file (`version filename sha256`), no JSON
  # parsing needed. Falls straight through to nodejs.org/npmmirror on any failure below.
  if download "$OSS_NODE_MIRROR/latest/$OS-$ARCH.txt" "$tmp/pointer.txt" 15 2>/dev/null; then
    oss_version="" oss_file="" oss_sum=""
    read -r oss_version oss_file oss_sum < "$tmp/pointer.txt" 2>/dev/null || true
    if [ -n "$oss_version" ] && [ -n "$oss_file" ] && [ -n "$oss_sum" ] \
       && download "$OSS_NODE_MIRROR/$oss_version/$oss_file" "$tmp/$oss_file" 300 2>/dev/null \
       && [ "$(sha256_of "$tmp/$oss_file")" = "$oss_sum" ]; then
      version="$oss_version"; file="$oss_file"; sum="$oss_sum"
      say "使用神念自有源下载 Node"
    else
      rm -f "$tmp/$oss_file" 2>/dev/null || true
    fi
  fi

  if [ -z "$file" ]; then
    # Newest v24 from the release index; mirrors can lag on the latest-v24.x alias.
    NODE_LINE="latest-v$NODE_MAJOR.x"
    if download "$NODE_DIST/index.json" "$tmp/index.json" 2>/dev/null; then
      version="$(grep -o "\"version\":\"v$NODE_MAJOR\.[0-9]*\.[0-9]*\"" "$tmp/index.json" | head -n 1 | cut -d'"' -f4 || true)"
      [ -n "$version" ] && NODE_LINE="$version"
    fi
    download "$NODE_DIST/$NODE_LINE/SHASUMS256.txt" "$tmp/SHASUMS256.txt" \
      || download "$NODE_DIST_OFFICIAL/$NODE_LINE/SHASUMS256.txt" "$tmp/SHASUMS256.txt" \
      || fail "无法下载 Node 版本列表，请检查网络后重试。"
    line="$(grep " node-v[0-9.]*-$OS-$ARCH\.tar\.gz\$" "$tmp/SHASUMS256.txt" | head -n 1 || true)"
    [ -n "$line" ] || fail "没有找到适合 $OS-$ARCH 的 Node 安装包。"
    sum="${line%% *}"
    file="${line##* }"
    download "$NODE_DIST/$NODE_LINE/$file" "$tmp/$file" 300 \
      || download "$NODE_DIST_OFFICIAL/$NODE_LINE/$file" "$tmp/$file" 300 \
      || fail "Node 下载失败，请检查网络后重试。"
  fi
  [ "$(sha256_of "$tmp/$file")" = "$sum" ] || fail "下载的 Node 校验失败（文件不完整或被篡改），请重试。"
  mkdir -p "$tmp/extract"
  tar -xzf "$tmp/$file" -C "$tmp/extract"
  extracted="$tmp/extract/${file%.tar.gz}"
  [ -x "$extracted/bin/node" ] || fail "Node 安装包内容异常，请重试。"
  # npm's own launcher starts with `#!/usr/bin/env node`; a service started from this Node
  # has no PATH entry for it, so upgrades call npm through this wrapper.
  cat > "$extracted/bin/shennian-npm" <<'WRAPPER'
#!/bin/sh
dir="$(cd "$(dirname "$0")" && pwd)"
PATH="$dir:$PATH" exec "$dir/node" "$dir/../lib/node_modules/npm/bin/npm-cli.js" "$@"
WRAPPER
  chmod 755 "$extracted/bin/shennian-npm"
  mkdir -p "$(dirname "$RUNTIME_DIR")"
  rm -rf "$RUNTIME_DIR.old"
  [ -d "$RUNTIME_DIR" ] && mv "$RUNTIME_DIR" "$RUNTIME_DIR.old"
  mv "$extracted" "$RUNTIME_DIR"
  rm -rf "$RUNTIME_DIR.old"
  rm -rf "$tmp"; trap - EXIT
  say "Node $("$RUNTIME_DIR/bin/node" -v) 已就绪"
}

step "检查 Node"
NODE=""
PRIVATE_NODE=0
if [ -x "$RUNTIME_DIR/bin/node" ] && node_compatible "$RUNTIME_DIR/bin/node"; then
  NODE="$RUNTIME_DIR/bin/node"; PRIVATE_NODE=1
  say "使用神念专用的 Node $("$NODE" -v)"
elif have node && have npm && node_compatible "$(command -v node)"; then
  NODE="$(command -v node)"
  say "使用本机 Node $("$NODE" -v)"
else
  if have node; then say "本机 Node $(node -v 2>/dev/null || echo '') 版本过低或缺少 npm，改用神念专用的 Node"; fi
  install_private_node
  NODE="$RUNTIME_DIR/bin/node"; PRIVATE_NODE=1
fi
if [ "$PRIVATE_NODE" = 1 ]; then
  NPM="$RUNTIME_DIR/bin/shennian-npm"
  [ -x "$NPM" ] || fail "神念专用的 Node 缺少 npm，请删除 $RUNTIME_DIR 后重新运行。"
else
  NPM="npm"
fi

# ── 2. 神念 Client ────────────────────────────────────────────────────────────
npm_install() { # [prefix]
  if [ -n "${1:-}" ]; then
    set -- install -g "$CLI_PACKAGE" --no-fund --no-audit --no-update-notifier --loglevel=error --prefix "$1"
  else
    set -- install -g "$CLI_PACKAGE" --no-fund --no-audit --no-update-notifier --loglevel=error
  fi
  "$NPM" "$@" --registry "$REGISTRY" || "$NPM" "$@" --registry "$REGISTRY_ALT"
}

npm_global_writable() {
  root="$("$NPM" root -g 2>/dev/null || true)"
  [ -n "$root" ] || return 1
  if [ -d "$root" ]; then [ -w "$root" ]; else [ -w "$(dirname "$root")" ]; fi
}

write_launcher() { # entry node-command
  mkdir -p "$BIN_DIR"
  cat > "$BIN_DIR/shennian" <<LAUNCHER
#!/bin/sh
exec "$2" "$1" "\$@"
LAUNCHER
  chmod 755 "$BIN_DIR/shennian"
}

add_bin_to_path() {
  marker="# >>> shennian >>>"
  case "${SHELL:-}" in
    */zsh) rcs="$HOME/.zshrc" ;;
    */bash) if [ "$OS" = darwin ]; then rcs="$HOME/.bash_profile $HOME/.bashrc"; else rcs="$HOME/.bashrc"; fi ;;
    *) rcs="$HOME/.profile" ;;
  esac
  for rc in $rcs; do
    if [ -f "$rc" ] && grep -q "$marker" "$rc" 2>/dev/null; then continue; fi
    printf '\n%s\nexport PATH="%s:$PATH"\n# <<< shennian <<<\n' "$marker" "$BIN_DIR" >> "$rc"
  done
}

find_existing_entry() {
  own="$CLI_PREFIX/lib/node_modules/shennian/dist/bin/shennian.js"
  if [ -f "$own" ]; then echo "$own"; return; fi
  if [ "$PRIVATE_NODE" = 0 ] && have shennian; then
    # Follow the `shennian` actually on PATH, so an install under another prefix is
    # upgraded in place instead of getting a second copy.
    target="$("$NODE" -e 'try{console.log(require("fs").realpathSync(process.argv[1]))}catch{}' "$(command -v shennian)" 2>/dev/null || true)"
    case "$target" in */shennian/dist/bin/shennian.js) echo "$target" ;; esac
  fi
}

# `<entry> setup --help` exits 0 even when `setup` is not a real subcommand
# (commander prints the root help for any unrecognized command name), so the
# presence check has to look at the real command list instead.
has_setup() { "$NODE" "$1" --help 2>&1 | grep -qE '^ +setup( |$)'; }

step "安装神念 Client"
ENTRY="$(find_existing_entry || true)"
if [ -n "$ENTRY" ]; then
  say "发现已安装的神念 Client $("$NODE" "$ENTRY" --version 2>/dev/null || echo '')"
  if ! has_setup "$ENTRY"; then
    # Existing installs upgrade through the Client's own transactional updater, which
    # keeps a running background service safe; never overwrite its files with npm here.
    say "更新到最新版"
    "$NODE" "$ENTRY" upgrade --yes || true
    has_setup "$ENTRY" || fail "神念 Client 更新没有完成。请运行 shennian upgrade 查看原因，完成后重新运行本脚本。"
  fi
elif [ "$PRIVATE_NODE" = 0 ] && npm_global_writable; then
  npm_install || fail "神念 Client 安装失败，请检查网络后重试。"
  ENTRY="$("$NPM" root -g)/shennian/dist/bin/shennian.js"
else
  # Private Node, or a system npm whose global directory needs sudo: install for this user only.
  npm_install "$CLI_PREFIX" || fail "神念 Client 安装失败，请检查网络后重试。"
  ENTRY="$CLI_PREFIX/lib/node_modules/shennian/dist/bin/shennian.js"
fi
[ -f "$ENTRY" ] || fail "没有找到安装好的神念 Client。"
has_setup "$ENTRY" || fail "安装到的神念 Client 版本过旧，缺少 setup 命令。请稍后重试。"
case "$ENTRY" in
  "$CLI_PREFIX"/*)
    if [ "$PRIVATE_NODE" = 1 ]; then write_launcher "$ENTRY" "$NODE"; else write_launcher "$ENTRY" node; fi
    add_bin_to_path
    ;;
esac
say "神念 Client $("$NODE" "$ENTRY" --version) 已就绪"

# ── 3. 连接 ───────────────────────────────────────────────────────────────────
if [ -x "$BIN_DIR/shennian" ] && ! have shennian; then
  say "提示：新开一个终端后可以直接使用 shennian 命令（当前终端可用 $BIN_DIR/shennian）。"
fi

step "连接神念"
# setup prints the last line; with --json it is the {"type":"done",...} event AIs read.
status=0
if [ -t 1 ] && { : < /dev/tty; } 2>/dev/null; then
  # `curl | sh` feeds the script through stdin; give setup the real terminal so it can wait.
  "$NODE" "$ENTRY" setup "$@" < /dev/tty || status=$?
else
  "$NODE" "$ENTRY" setup "$@" || status=$?
fi
exit "$status"
