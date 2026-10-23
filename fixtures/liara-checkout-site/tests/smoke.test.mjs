import {test} from 'node:test';
import assert from 'node:assert/strict';
import {respond} from '../app.mjs';
test('home is available',()=>assert.equal(respond('http://localhost/').status,200));
test('health is available',()=>assert.equal(respond('http://localhost/health').status,200));
test('checkout reproduces the missing-coupon failure',()=>assert.equal(respond('http://localhost/api/checkout').status,500));
