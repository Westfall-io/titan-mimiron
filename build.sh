#!/bin/sh
# Build the titan-mimiron docker image, tagged with the version in
# ./VERSION plus :latest.
set -eu

VERSION=$(cat VERSION)

docker build \
  --build-arg VERSION="$VERSION" \
  -t "titan-mimiron:$VERSION" \
  -t "titan-mimiron:latest" \
  .

echo
echo "built: titan-mimiron:$VERSION (also tagged :latest)"
