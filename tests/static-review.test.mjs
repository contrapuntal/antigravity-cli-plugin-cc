import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseReviewOutput } from '../plugins/ask-antigravity/scripts/lib/static-review.mjs';
import { captureCommand } from '../plugins/ask-antigravity/scripts/lib/process.mjs';
const result = (value) => JSON.stringify({event:'result', result:value});
test('stdin carries prompts larger than argv limits', async () => {
  const input = 'x'.repeat(1024 * 1024);
  const output = await captureCommand(process.execPath, ['-e', 'process.stdin.pipe(process.stdout)'], {input});
  assert.equal(output.stdout, input);
});
test('early stdin close surfaces child failure without an unhandled EPIPE', async () => {
  const output = await captureCommand(process.execPath, ['-e', 'process.exit(7)'], {input:'x'.repeat(1024*1024)});
  assert.equal(output.status, 7);
});
test('extracts only a nonempty successful final review', () => {
  assert.equal(parseReviewOutput(result({status:'SUCCESS',response:' Finding '})).answer, 'Finding');
  for (const raw of ['', 'not json', result({status:'SUCCESS',response:' '}), result({status:'ERROR',response:'partial',error:'timeout'}), result({status:'SUCCESS',response:'ok'})+'\n'+result({status:'SUCCESS',response:'other'})]) {
    assert.ok(parseReviewOutput(raw).error, raw);
  }
});
test('reports exact denied tool command even with exit-zero SUCCESS', () => {
  const raw = JSON.stringify({event:'step_update',step_update:{step_type:'tool',tool_name:'run_command',tool_info:{parameters:{CommandLine:'pwd && git status'},error:{message:'permission check failed'}}}})+'\n'+result({status:'SUCCESS',response:'',denied_actions:[{action:'command',display_name:'RunCommand'}]});
  const parsed = parseReviewOutput(raw);
  assert.match(parsed.error, /pwd && git status/);
  assert.match(parsed.error, /RunCommand/);
  assert.equal(parsed.answer, undefined);
});

test('permission denial rejects even a nonempty success response', () => {
  const parsed = parseReviewOutput(result({status:'SUCCESS',response:'partial findings',denied_actions:[{action:'command'}]}));
  assert.ok(parsed.error);
  assert.equal(parsed.answer, undefined);
});
test('ignores narration and unknown events, accepts CRLF', () => {
  const raw = JSON.stringify({event:'step_update',step_update:{text_delta:'narration'}})+'\r\n'+result({status:'SUCCESS',response:'final'})+'\r\n';
  assert.equal(parseReviewOutput(raw).answer, 'final');
});
