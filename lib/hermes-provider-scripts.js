'use strict';

const fs = require('fs');
const path = require('path');

const SCRIPT_DIR = path.join(__dirname, 'hermes-provider-scripts');
const HERMES_PROVIDER_SCRIPT_PATHS = Object.freeze({
  discover: path.join(SCRIPT_DIR, 'discover.py'),
  read: path.join(SCRIPT_DIR, 'read.py'),
  switch: path.join(SCRIPT_DIR, 'switch.py'),
});

function readHermesProviderScript(name) {
  const scriptPath = HERMES_PROVIDER_SCRIPT_PATHS[name];
  if (!scriptPath) throw new Error(`Unknown Hermes provider script: ${name}`);
  return fs.readFileSync(scriptPath, 'utf8');
}

module.exports = {
  HERMES_PROVIDER_SCRIPT_PATHS,
  readHermesProviderScript,
};
