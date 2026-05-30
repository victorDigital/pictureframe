#!/usr/bin/env bash
set -euo pipefail

target_root="${1:-${XDG_DATA_HOME:-${HOME:-/home/frame}/.local/share}/icons}"
src="$(dirname "$0")/transparent.xcursor.b64"
theme_dir="$target_root/frame-transparent"
cursor_dir="$theme_dir/cursors"
cursor_file="$cursor_dir/left_ptr"

[[ -f "$src" ]] || exit 0
mkdir -p "$cursor_dir"
printf '[Icon Theme]\nName=frame-transparent\n' > "$theme_dir/index.theme"
base64 -d < "$src" > "$cursor_file.tmp"
mv "$cursor_file.tmp" "$cursor_file"

for name in default arrow pointer hand1 hand2 text xterm ibeam cross crosshair wait watch progress left_ptr_watch question_arrow dnd-ask no-drop not-allowed all-scroll sb_h_double_arrow sb_v_double_arrow col-resize row-resize grab grabbing move; do
  ln -sf left_ptr "$cursor_dir/$name"
done
