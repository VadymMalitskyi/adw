#!/usr/bin/env node
// Offline fixture placeholder used by consumer workflow tests; it never calls a
// provider or network service.
process.stdout.write(JSON.stringify({ status: "passed", findings: [] }));
