#!/usr/bin/env bash
set -euo pipefail

repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
platform=linux/amd64
output=

usage() {
  echo "Usage: bash scripts/package-compose.sh [--platform linux/amd64|linux/arm64] [--output archive.tar.gz]"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --platform|--output)
      if [[ $# -lt 2 || -z "$2" ]]; then usage >&2; exit 1; fi
      if [[ "$1" == --platform ]]; then platform="$2"; else output="$2"; fi
      shift 2
      ;;
    -h|--help) usage; exit 0 ;;
    *) usage >&2; exit 1 ;;
  esac
done

case "$platform" in
  linux/amd64|linux/arm64) ;;
  *) echo "Supported platforms: linux/amd64, linux/arm64" >&2; exit 1 ;;
esac

if [[ -z "$output" ]]; then
  output="$repo_dir/release/niimblue-compose-${platform//\//-}.tar.gz"
fi
if [[ -e "$output" ]]; then
  echo "Output already exists; choose another --output path: $output" >&2
  exit 1
fi

docker info >/dev/null
docker buildx version >/dev/null
docker compose version >/dev/null
mkdir -p "$(dirname "$output")"
output="$(cd "$(dirname "$output")" && pwd)/$(basename "$output")"
stage_dir="$(mktemp -d "${TMPDIR:-/tmp}/niimblue-compose.XXXXXX")"
trap 'rm -rf "$stage_dir"' EXIT
bundle_dir="$stage_dir/niimblue"
mkdir "$bundle_dir"

# --load produces single-platform images which docker save/load can transport.
docker buildx build --platform "$platform" --target https-server \
  --tag niimblue-web:local --load "$repo_dir"
docker buildx build --platform "$platform" \
  --tag niimblue-storage:local --load "$repo_dir/server"

cp "$repo_dir/compose.yaml" "$bundle_dir/compose.yaml"
sed "s|^NIIMBLUE_PLATFORM=.*|NIIMBLUE_PLATFORM=$platform|" \
  "$repo_dir/.env.deploy.example" > "$bundle_dir/.env.deploy.example"
cp "$repo_dir/docs/deployment.zh-CN.md" "$bundle_dir/README.zh-CN.md"
cp "$repo_dir/LICENSE" "$bundle_dir/LICENSE"
printf '%s\n' "Platform: $platform" "Built at: $(date -u '+%Y-%m-%dT%H:%M:%SZ')" > "$bundle_dir/BUILD.txt"
docker image save --output "$bundle_dir/images.tar" niimblue-web:local niimblue-storage:local
tar -czf "$stage_dir/bundle.tar.gz" -C "$stage_dir" niimblue
mv "$stage_dir/bundle.tar.gz" "$output"

echo "Created: $output"
echo "On the target machine: extract, docker load -i images.tar, configure .env.deploy, then docker compose --env-file .env.deploy up -d --pull never"
