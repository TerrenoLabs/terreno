#!/usr/bin/env bun
import {runTestHygieneCli} from "./testHygiene";

process.exitCode = runTestHygieneCli({argv: process.argv.slice(2)}).exitCode;
