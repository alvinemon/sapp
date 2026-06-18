#!/usr/bin/env bash
# Source before Android builds: source scripts/android-env.sh
export JAVA_HOME="${JAVA_HOME:-/Users/alvin/jdk17/Contents/Home}"
export ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
export PATH="$JAVA_HOME/bin:$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$ANDROID_HOME/cmdline-tools/latest/bin:$PATH"
