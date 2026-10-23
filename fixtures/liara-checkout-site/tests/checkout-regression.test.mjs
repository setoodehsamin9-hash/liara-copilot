import {test} from 'node:test';
import assert from 'node:assert/strict';
import {respond} from '../app.mjs';
test('checkout without optional coupon should succeed',()=>assert.equal(respond('http://localhost/api/checkout').status,200));
