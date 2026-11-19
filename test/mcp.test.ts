import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { User } from '../src/domain/types.js';
import { handleLine, handleMessage, type McpDeps } from '../src/mcp/protocol.js';
import { buildTools } from '../src/mcp/tools.js';
import { makeWorld, TOMORROW } from './helpers.js';

async function mcpAs(pick: (users: Awaited<ReturnType<typeof makeWorld>>['users']) => User | null) {
  const world = await makeWorld();
  const token = pick(world.users) ? await world.services.auth.issueToken(pick(world.users)!) : 'not-a-token';
  const deps: McpDeps = {
    tools: buildTools(world.services),
    resolveUser: () => world.services.auth.userForToken(token),
    log: () => {},
  };
  let nextId = 1;
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const response = (await handleMessage(
      { jsonrpc: '2.0', id: nextId++, method: 'tools/call', params: { name, arguments: args } },
      deps,
    )) as { result: { content: { text: string }[]; isError: boolean } };
    const text = response.result.content[0]!.text;
    return { isError: response.result.isError, text, data: response.result.isError ? null : JSON.parse(text) };
  };
  return { ...world, deps, call };
}

describe('MCP protocol', () => {
  test('AC-21 initialize, then tools/list returns nine tools with real descriptions', async () => {
    const { deps } = await mcpAs((u) => u.student);
    const init = (await handleMessage(
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26' } },
      deps,
    )) as any;
    assert.equal(init.result.protocolVersion, '2025-03-26');
    assert.deepEqual(init.result.capabilities, { tools: {} });
    const unknownVersion = (await handleMessage({ jsonrpc: '2.0', id: 2, method: 'initialize', params: {} }, deps)) as any;
    assert.equal(unknownVersion.result.protocolVersion, '2025-06-18');

    assert.equal(await handleMessage({ jsonrpc: '2.0', method: 'notifications/initialized' }, deps), null);

    const list = (await handleMessage({ jsonrpc: '2.0', id: 3, method: 'tools/list' }, deps)) as any;
    const tools = list.result.tools as { name: string; description: string; inputSchema: { type: string } }[];
    assert.equal(tools.length, 9);
    for (const tool of tools) {
      assert.ok(tool.description.length >= 20, `${tool.name} needs a description of 20+ characters`);
      assert.equal(tool.inputSchema.type, 'object');
    }
    assert.deepEqual(
      tools.map((t) => t.name),
      ['list_labs', 'list_free_slots', 'my_bookings', 'book_slot', 'cancel_booking', 'suggest_slot', 'pending_approvals', 'approve_booking', 'reject_booking'],
    );
  });

  test('AC-21 protocol errors: bad JSON, bad request, unknown method, unknown tool, ping', async () => {
    const { deps } = await mcpAs((u) => u.student);
    assert.deepEqual(await handleLine('{not json', deps), { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
    assert.equal(await handleLine('   ', deps), null);
    assert.equal(((await handleLine('{"jsonrpc":"1.0","id":1,"method":"x"}', deps)) as any).error.code, -32600);
    assert.equal(((await handleMessage(null, deps)) as any).error.code, -32600);
    assert.equal(((await handleLine('{"jsonrpc":"2.0","id":5,"method":"nope"}', deps)) as any).error.code, -32601);
    assert.deepEqual(await handleLine('{"jsonrpc":"2.0","id":6,"method":"ping"}', deps), { jsonrpc: '2.0', id: 6, result: {} });
    const unknownTool = (await handleMessage({ jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'drop_tables' } }, deps)) as any;
    assert.equal(unknownTool.error.code, -32602);
  });
});

describe('MCP tools use the services, as one user', () => {
  test('AC-22 a student books, lists and cancels through the tools', async () => {
    const { call, labs } = await mcpAs((u) => u.student);
    assert.equal((await call('list_labs')).data.length, 2);
    const free = await call('list_free_slots', { date: TOMORROW });
    assert.equal(free.data[0].freeHours.length, 12);
    const booked = await call('book_slot', { labId: labs.network.id, date: TOMORROW, hour: 9, purpose: 'agent' });
    assert.equal(booked.data.status, 'pending');
    assert.equal((await call('my_bookings')).data.length, 1);
    const suggestion = await call('suggest_slot', { text: 'за 3 души', date: TOMORROW });
    assert.equal(suggestion.data.source, 'fallback');
    assert.equal((await call('cancel_booking', { bookingId: booked.data.id })).data.status, 'cancelled');
  });

  test("AC-22 cancelling someone else's booking and exceeding the limit are refused, as over HTTP", async () => {
    const { call, services, users, labs } = await mcpAs((u) => u.student);
    const theirs = await services.bookings.create(users.other, { labId: labs.network.id, date: TOMORROW, hour: 8 });
    const refused = await call('cancel_booking', { bookingId: theirs.id });
    assert.equal(refused.isError, true);
    assert.match(refused.text, /само своите/);

    for (const hour of [9, 10, 11]) await call('book_slot', { labId: labs.network.id, date: TOMORROW, hour });
    const fourth = await call('book_slot', { labId: labs.network.id, date: TOMORROW, hour: 12 });
    assert.equal(fourth.isError, true);
    assert.match(fourth.text, /3 предстоящи/);

    const notTeacher = await call('pending_approvals');
    assert.equal(notTeacher.isError, true);
  });

  test('AC-22 a teacher approves and rejects only in their own lab', async () => {
    const { call, services, users, labs } = await mcpAs((u) => u.teacher);
    const mine = await services.bookings.create(users.student, { labId: labs.network.id, date: TOMORROW, hour: 9 });
    const other = await services.bookings.create(users.student, { labId: labs.network.id, date: TOMORROW, hour: 10 });
    const notMine = await services.bookings.create(users.other, { labId: labs.robots.id, date: TOMORROW, hour: 9 });
    assert.equal((await call('pending_approvals')).data.length, 2);
    assert.equal((await call('approve_booking', { bookingId: mine.id })).data.status, 'approved');
    assert.equal((await call('reject_booking', { bookingId: other.id })).data.status, 'rejected');
    assert.equal((await call('approve_booking', { bookingId: notMine.id })).isError, true);
  });

  test('AC-22 an unexpected failure inside a tool is reported without details', async () => {
    const { deps } = await mcpAs((u) => u.student);
    const broken = { ...deps, tools: [{ ...deps.tools[0]!, run: async () => { throw new Error('connection refused at 10.0.0.5'); } }] };
    const response = (await handleMessage({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'list_labs' } }, broken)) as any;
    assert.equal(response.result.isError, true);
    assert.equal(response.result.content[0].text, 'The tool failed unexpectedly.');
  });

  test('AC-23 without a valid session token every tool call is refused', async () => {
    const { call } = await mcpAs(() => null);
    const result = await call('list_labs');
    assert.equal(result.isError, true);
    assert.match(result.text, /Session token is missing or expired/);
  });
});
