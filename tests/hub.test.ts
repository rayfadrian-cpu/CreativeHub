import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { handleHub } from '../db/hub-service';
import { roles, statuses, type Role } from '../lib/hub-types';

// Execute the actual migrations and service SQL against SQLite, without any
// authentication bypass in the deployed application.
function fixture() {
  const sqlite = new DatabaseSync(':memory:');
  const files = readdirSync('drizzle').filter(x => x.endsWith('.sql')).sort();
  sqlite.exec(readFileSync('drizzle/' + files[0], 'utf8'));
  sqlite.exec("INSERT INTO content_items (id,owner_id,title,publish_date,pillar,platform,pic,caption,notes) VALUES (42,'legacy-user','Preserve me','2026-09-25','Education','Instagram','Legacy PIC','Original caption','Original notes')");
  for (const file of files.slice(1)) sqlite.exec(readFileSync('drizzle/' + file, 'utf8'));
  function prepare(sql: string) {
    let args: any[] = [];
    const statement = {
      bind(...values: any[]) { args = values; return statement; },
      async first() { return sqlite.prepare(sql).get(...args) ?? null; },
      async all() { return { results: sqlite.prepare(sql).all(...args), success: true }; },
      async run() { const r = sqlite.prepare(sql).run(...args); return { success: true, meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } }; },
    }; return statement;
  }
  const db = { prepare, async batch(statements: ReturnType<typeof prepare>[]) { sqlite.exec('BEGIN'); try { const result = []; for (const s of statements) result.push(await s.run()); sqlite.exec('COMMIT'); return result; } catch (e) { sqlite.exec('ROLLBACK'); throw e; } } } as unknown as D1Database;
  const identity = (role: string) => ({ userId: role + '-user', email: role.replaceAll(' ', '').toLowerCase() + '@example.com', displayName: role + ' Person' });
  async function call(role: string | null, method: string, path: string, payload?: any, headers: Record<string,string> = {}) {
    const request = new Request('https://creative.test/api/hub/' + path, { method, headers: { origin: 'https://creative.test', ...headers }, ...(payload === undefined ? {} : { body: JSON.stringify(payload) }) });
    const response = await handleHub(request, path.split('/'), { db, identity: role ? identity(role) : null, ownerEmail: 'owner@example.com' });
    return { status: response.status, data: await response.json() as any };
  }
  async function start() {
    assert.equal((await call('Owner','GET','workspace')).status, 200);
    for (const role of roles.filter(x => x !== 'Owner')) {
      const r = await call('Owner','POST','members', { name: role + ' Person', email: identity(role).email, role }); assert.equal(r.status,201);
      assert.equal((await call(role,'GET','workspace')).status,200);
    }
  }
  const memberId = (role: Role) => Number((sqlite.prepare('SELECT id FROM members WHERE role = ?').get(role) as any).id);
  function item(status = 'Idea', assignee: Role = 'Creative') {
    const r = sqlite.prepare("INSERT INTO content_items (owner_id,title,publish_date,pillar,platform,pic,assignee_id,status) VALUES ('Owner-user','Test card','2026-10-01','','Instagram',?,?,?)").run(assignee + ' Person', memberId(assignee), status);
    return Number(r.lastInsertRowid);
  }
  return { sqlite, call, start, memberId, item };
}

test('migration preserves legacy content; authentication and owner bootstrap are protected', async () => {
  const f = fixture();
  assert.equal((await f.call(null,'GET','workspace')).status,401);
  assert.equal((await f.call('Stranger','GET','workspace')).status,403);
  assert.equal((f.sqlite.prepare('SELECT COUNT(*) AS n FROM members').get() as any).n,0);
  await f.start();
  const r = (await f.call('Owner','GET','workspace')).data;
  assert.equal(r.actor.role,'Owner'); assert.equal(r.items.length,1);
  assert.deepEqual([r.items[0].id,r.items[0].title,r.items[0].caption,r.items[0].notes,r.items[0].pic], [42,'Preserve me','Original caption','Original notes','Legacy PIC']);
  assert.ok(r.items[0].pillarId);
  assert.equal((await f.call('Owner','PUT','content/42',{version:1,title:'Bad origin'},{origin:'https://evil.test'})).status,403);
  assert.equal((await f.call('Viewer','GET','workspace')).data.members[0].email,undefined);
  f.sqlite.close();
});

const transitions: Record<Role, (from:string,to:string)=>boolean> = {
  Owner:()=>true, Admin:()=>true,
  'Content Strategist':(from,to)=>!['Approved','Scheduled'].includes(from)&&!['Approved','Scheduled'].includes(to),
  Creative:(from,to)=>!['Approved','Scheduled'].includes(from)&&!['Approved','Scheduled'].includes(to),
  Designer:(from,to)=>['Design','Review'].includes(from)&&['Design','Review'].includes(to),
  'Social Media':(from,to)=>from==='Approved'&&to==='Scheduled',
  Approver:(from,to)=>from==='Review'&&['Approved','Revision'].includes(to), Viewer:()=>false,
};
for (const role of roles) test(`${role}: every status transition is enforced by server and persists`, async () => {
  const f = fixture(); await f.start();
  for (const from of statuses) for (const to of statuses) {
    if (from === to) continue;
    const id = f.item(from, role);
    const response = await f.call(role,'PATCH',`content/${id}/status`,{status:to,version:1});
    const allowed = transitions[role](from,to);
    assert.equal(response.status,allowed?200:403,`${role}: ${from} -> ${to}: ${JSON.stringify(response.data)}`);
    const saved = (await f.call('Owner','GET',`content/${id}`)).data.item;
    assert.equal(saved.status,allowed?to:from); assert.equal(saved.version,allowed?2:1);
  }
  f.sqlite.close();
});

for (const role of roles) test(`${role}: edit/create/delete/settings/team permissions cannot be bypassed`, async () => {
  const f = fixture(); await f.start(); const id = f.item('Design',role);
  const manager = ['Owner','Admin'].includes(role), strategist = manager || role === 'Content Strategist';
  const creating = strategist || role === 'Creative';
  const create = await f.call(role,'POST','content',{title:'New',publishDate:'2026-10-02',brand:'Creative Hub',platform:'Instagram',status:'Idea',priority:'Normal'});
  assert.equal(create.status,creating?201:403);
  if(role==='Creative') assert.equal(create.data.item.assigneeId,f.memberId(role));
  let version=1;
  for (const field of ['title','caption','notes','publishDate','platform','priority']) {
    const allowed = strategist || role==='Creative' || (role==='Designer' && field==='notes') || (role==='Social Media' && ['caption','platform','publishDate'].includes(field));
    const value = field==='publishDate'?'2026-10-03':field==='priority'?'High':'Updated '+field;
    const r = await f.call(role,'PUT',`content/${id}`,{version,[field]:value});
    assert.equal(r.status,allowed?200:403,`${role} ${field}: ${JSON.stringify(r.data)}`); if(allowed)version++;
  }
  assert.equal((await f.call(role,'PUT',`content/${id}`,{version,status:'Approved'})).status,manager?200:403);
  if(manager)version++;
  assert.equal((await f.call(role,'PATCH','workspace',{name:'Renamed'})).status,role==='Owner'?200:403);
  assert.equal((await f.call(role,'POST','members',{name:'New member',email:'new@example.com',role:'Viewer'})).status,manager?201:403);
  assert.equal((await f.call(role,'POST','pillars',{name:'Test',description:'',objective:'',color:'#123456',active:true})).status,strategist?201:403);
  assert.equal((await f.call(role,'DELETE',`content/${id}`,{version})).status,manager?200:403);
  f.sqlite.close();
});

test('assigned-content restrictions, rejected review, concurrency, and dates', async () => {
  const f=fixture(); await f.start(); const id=f.item('Design','Creative');
  assert.equal((await f.call('Designer','GET',`content/${id}`)).status,403);
  assert.equal((await f.call('Designer','GET','workspace')).data.items.length,0);
  const other=f.item('Idea','Owner');
  assert.equal((await f.call('Creative','PUT',`content/${other}`,{version:1,title:'Unauthorized'})).status,403);
  assert.equal((await f.call('Creative','PATCH',`content/${other}/status`,{version:1,status:'Writing'})).status,403);
  assert.equal((await f.call('Creative','PUT',`content/${id}`,{version:1,assigneeId:f.memberId('Owner')})).status,403);
  assert.equal((await f.call('Owner','PUT',`content/${id}`,{version:1,publishDate:'2026-02-30'})).status,400);
  assert.equal((await f.call('Owner','PATCH',`content/${id}/status`,{version:1,status:'Review'})).status,200);
  assert.equal((await f.call('Owner','PATCH',`content/${id}/status`,{version:1,status:'Approved'})).status,409);
  const reject=await f.call('Approver','PATCH',`content/${id}/status`,{version:2,status:'Revision',decision:'rejected'});
  assert.equal(reject.status,200); assert.equal(reject.data.item.reviewDecision,'rejected');
  f.sqlite.close();
});

test('pillar CRUD, inactive assignment, reorder and deletion retain content', async()=>{
  const f=fixture();await f.start();
  const payload={name:'New pillar',description:'Description',objective:'Objective',color:'#0099aa',active:true};
  assert.equal((await f.call('Content Strategist','POST','pillars',payload)).status,201);
  let data=(await f.call('Owner','GET','workspace')).data;
  const pillar=data.pillars.find((p:any)=>p.name===payload.name);
  assert.equal((await f.call('Owner','PUT','content/42',{version:1,pillarId:pillar.id})).status,200);
  assert.equal((await f.call('Content Strategist','PUT','pillars/'+pillar.id,{...payload,name:'Renamed pillar',active:false})).status,200);
  let item=(await f.call('Owner','GET','content/42')).data.item;
  assert.equal(item.pillar,'Renamed pillar');
  const another=f.item();
  assert.equal((await f.call('Owner','PUT','content/'+another,{version:1,pillarId:pillar.id})).status,400);
  const ids=data.pillars.map((p:any)=>p.id).reverse();
  assert.equal((await f.call('Owner','PATCH','pillars/reorder',{ids})).status,200);
  assert.deepEqual((await f.call('Owner','GET','workspace')).data.pillars.map((p:any)=>p.id),ids);
  assert.equal((await f.call('Owner','DELETE','pillars/'+pillar.id,{})).status,400);
  assert.equal((await f.call('Owner','DELETE','pillars/'+pillar.id,{confirm:true})).status,200);
  item=(await f.call('Owner','GET','content/42')).data.item;
  assert.equal(item.pillarId,null);assert.equal(item.caption,'Original caption');
  assert.equal((await f.call('Owner','GET','workspace')).data.items.length,2);
  f.sqlite.close();
});

test('team roles, inactive members, owner protection and collection management',async()=>{
  const f=fixture();await f.start();const owner=f.memberId('Owner'),creative=f.memberId('Creative');
  assert.equal((await f.call('Admin','PATCH','members/'+owner,{role:'Viewer',status:'Inactive'})).status,403);
  assert.equal((await f.call('Owner','PATCH','members/'+owner,{role:'Viewer',status:'Active'})).status,403);
  assert.equal((await f.call('Admin','PATCH','members/'+creative,{role:'Owner',status:'Active'})).status,403);
  assert.equal((await f.call('Admin','PATCH','members/'+creative,{role:'Viewer',status:'Inactive'})).status,200);
  assert.equal((await f.call('Creative','GET','workspace')).status,403);
  assert.equal((await f.call('Admin','PATCH','members/'+creative,{role:'Viewer',status:'Active'})).status,200);
  assert.equal((await f.call('Creative','GET','workspace')).data.actor.role,'Viewer');
  assert.equal((await f.call('Content Strategist','POST','collections',{kind:'campaign',name:'Launch',description:''})).status,201);
  assert.equal((await f.call('Content Strategist','POST','collections',{kind:'brand',name:'Other',description:''})).status,403);
  assert.equal((await f.call('Admin','POST','collections',{kind:'brand',name:'Other',description:''})).status,201);
  f.sqlite.close();
});
