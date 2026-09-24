// The note after an update comes with a feature release only. A first install,
// a bug-fix release and a downgrade stay quiet.
//
// Run after `tsc -p ./`:  node test/feature-update.test.cjs

const assert = require('assert');
const { isFeatureUpdate } = require('../out/featureUpdate');

assert.strictEqual(isFeatureUpdate(undefined, '1.23.0'), false, 'first install');
assert.strictEqual(isFeatureUpdate('1.23.0', '1.23.1'), false, 'bug-fix release');
assert.strictEqual(isFeatureUpdate('1.23.1', '1.24.0'), true, 'new minor version');
assert.strictEqual(isFeatureUpdate('1.23.0', '2.0.0'), true, 'new major version');
assert.strictEqual(isFeatureUpdate('1.24.0', '1.23.0'), false, 'downgrade');
assert.strictEqual(isFeatureUpdate('1.9.0', '1.10.0'), true, 'compared as numbers, not text');

console.log('All feature update tests passed.');
