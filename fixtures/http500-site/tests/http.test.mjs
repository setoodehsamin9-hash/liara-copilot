import {test} from 'node:test';
import assert from 'node:assert/strict';
import {respond} from '../app.mjs';
test('request without a name must return HTTP 200 and the default greeting',()=>{
  assert.deepEqual(respond('http://127.0.0.1/'),{status:200,body:'سلام دوست'});
});
test('named requests retain their existing behavior',()=>{
  assert.deepEqual(respond('http://127.0.0.1/?name=Sara'),{status:200,body:'سلام Sara'});
});
