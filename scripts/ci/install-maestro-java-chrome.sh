#!/bin/sh
# Java runs Maestro and Chrome drives the web flows. Used by the maestro-e2e and
# maestro-demo CircleCI jobs.
set -eu
sudo apt-get update
sudo apt-get install -y --no-install-recommends openjdk-17-jre-headless xvfb xauth x11-utils
if ! command -v google-chrome > /dev/null 2>&1; then
  curl -fsSL -o /tmp/google-chrome.deb https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb
  sudo apt-get install -y /tmp/google-chrome.deb
fi
google-chrome --version
