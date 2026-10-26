#!/usr/bin/env bun
import {runTestShardCli} from "./testShard";

process.exitCode = runTestShardCli({argv: process.argv.slice(2)}).exitCode;
