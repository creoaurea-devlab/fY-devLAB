#!/usr/bin/env python3
"""Validate this proposal without editing project authority or executing check strings."""
import argparse,fnmatch,json,re,sqlite3,sys
from pathlib import Path
p=argparse.ArgumentParser()
p.add_argument('--root',type=Path)
p.add_argument('--require-registered',action='store_true')
a=p.parse_args();here=Path(__file__).resolve().parent
bundle=json.loads((here/'tickets.json').read_text()); tasks=bundle['tasks']
proposed=json.loads((here/'ownership-proposals.json').read_text())['paths']
snapshot=json.loads((here/'ownership-snapshot.json').read_text())
errors=[];warnings=[];by={t['id']:t for t in tasks}
if len(by)!=len(tasks):errors.append('duplicate task IDs')
parents={};visiting=set();done=set()
def visit(k):
 if k in visiting:errors.append('dependency cycle at '+k);return set()
 if k in done:return parents[k]
 visiting.add(k);result=set()
 for d in by[k]['needs']:
  if d not in by:errors.append(f'{k}: missing dependency {d}');continue
  result.add(d);result.update(visit(d))
 visiting.remove(k);done.add(k);parents[k]=result;return result
for k in by:visit(k)
capabilities=snapshot['capabilities'];authority='reviewed ownership snapshot (proposal validation only)'
if a.root:
 db=a.root.resolve()/'.wisdohm/memory.sqlite'
 try:
  with sqlite3.connect(db.as_uri()+'?mode=ro',uri=True) as cx:
   rows=cx.execute('SELECT id,body FROM capabilities').fetchall()
  capabilities={i:json.loads(body) for i,body in rows};authority='current SQL capabilities'
 except (sqlite3.Error,OSError) as e:
  warnings.append('SQL capabilities unavailable: '+str(e))
  if a.require_registered:errors.append('current SQL capabilities required')
def match(path,pattern):
 return path==pattern or fnmatch.fnmatchcase(path,pattern)
pending=[]
for t in tasks:
 for key in ['title','owner','profile','reads','writes','needs','checks','acceptance','rollback','milestone','slice','document']:
  if key not in t:errors.append(t['id']+': missing '+key)
 if t.get('status') is not None:errors.append(t['id']+': duplicate status authority')
 if not t['checks'] or not t['acceptance']:errors.append(t['id']+': empty checks/acceptance')
 if t['owner'] not in capabilities:errors.append(t['id']+': unknown owner '+t['owner'])
 if snapshot['profiles'].get(t['owner'])!=t['profile']:errors.append(t['id']+': mismatched owner profile')
 document=(here/t['document']).resolve()
 if not document.is_relative_to(here) or not document.is_file():errors.append(t['id']+': missing/escaping document')
 for path in t['writes']:
  if Path(path).is_absolute() or '..' in Path(path).parts or any(x in path for x in '*?['):errors.append(t['id']+': non-exact write '+path);continue
  owners=[key for key,value in capabilities.items() if any(match(path,pat) for pat in value.get('paths',[]))]
  if owners==[t['owner']]:continue
  if not owners and proposed.get(path)==t['owner'] and ('AR-01' in parents[t['id']] or t['id']=='AR-01'):
   pending.append(path)
  else:errors.append(f"{t['id']}: write {path} owners={owners} expected={t['owner']}")
 if a.root:
  for path in t['reads']:
   if not (a.root/path).exists() and path not in proposed and path not in {x for c in tasks for x in c['writes']}:
    warnings.append(t['id']+': unresolved read '+path)
ordered=[]
for i,left in enumerate(tasks):
 for right in tasks[i+1:]:
  overlap=sorted(set(left['writes'])&set(right['writes']))
  if overlap:
   before=left['id'] in parents[right['id']];after=right['id'] in parents[left['id']]
   if not (before or after):errors.append(f"unordered writes {left['id']}/{right['id']}: {overlap}")
   else:ordered.append({'before':left['id'] if before else right['id'],'after':right['id'] if before else left['id'],'paths':overlap})
for file in ['SPEC.md','ROADMAP.md']:
 if not (here/file).is_file():errors.append('missing '+file)
for document in here.rglob('*.md'):
 for _,link in re.findall(r'\[([^\]]+)\]\(([^)]+)\)',document.read_text()):
  if '://' in link or link.startswith('#'):continue
  target=(document.parent/link.split('#')[0]).resolve()
  if not target.is_file():errors.append(str(document.relative_to(here))+': broken link '+link)
expected={f'AC-{n:02}' for n in range(1,11)}
covered={item.split(':',1)[0] for task in tasks for item in task['acceptance']}
if expected-covered:errors.append('uncovered acceptance: '+', '.join(sorted(expected-covered)))
if pending and a.require_registered:errors.append('unregistered writes: '+', '.join(sorted(set(pending))))
if a.root:
    canonical_path=a.root.resolve()/'.context/state/tasks.json'
    canonical=json.loads(canonical_path.read_text())
    canonical_tasks={item['id']:item for item in canonical['tasks']}
    fresh=[t for t in tasks if t['disposition']=='new-regression-or-migration-task']
    for t in tasks:
        item=canonical_tasks.get(t['canonical_task_id'])
        if item is None:
            errors.append(t['id']+': missing canonical task');continue
        if item['module']!=t['owner']:errors.append(t['id']+': canonical owner differs')
        if t['disposition']=='migrated-specification':
            if item.get('spec')!=t.get('current_spec') or not (a.root/t.get('current_spec','')).is_file():errors.append(t['id']+': current migrated spec link differs or is missing')
        elif t['disposition']=='new-regression-or-migration-task':
            for left,right in [('reads','read'),('writes','write'),('checks','verify'),('acceptance','acceptance'),('canonical_dependencies','depends_on')]:
                if t[left]!=item[right]:errors.append(t['id']+': canonical '+right+' differs')
    seen=set();visiting=set()
    def canonical_visit(identity):
        if identity in visiting:errors.append('canonical dependency cycle: '+identity);return
        if identity in seen:return
        visiting.add(identity)
        for dependency in canonical_tasks[identity]['depends_on']:
            if dependency not in canonical_tasks:errors.append('missing canonical dependency '+dependency)
            else:canonical_visit(dependency)
        visiting.remove(identity);seen.add(identity)
    for identity in canonical_tasks:canonical_visit(identity)
    for t in fresh:
        for old in canonical_tasks.values():
            status=json.loads((a.root.resolve()/'.context/state/progress.json').read_text())['states'].get(old['id'],{}).get('status')
            if status in ('running','review') and set(t['writes'])&set(old['write']):
                def prerequisites(identity,acc=None):
                    acc=set() if acc is None else acc
                    for dep in canonical_tasks[identity]['depends_on']:
                        if dep not in acc:acc.add(dep);prerequisites(dep,acc)
                    return acc
                if old['id'] not in prerequisites(t['id']):errors.append(t['id']+': active/review overlap lacks handoff dependency '+old['id'])
result={'valid_proposal':not errors,'authority_checked':authority,'tickets':len(tasks),'acyclic':not any('cycle' in x for x in errors),'serialized_overlap_pairs':len(ordered),'pending_registration':sorted(set(pending)),'warnings':sorted(set(warnings)),'errors':errors,'note':'Valid proposal does not establish runtime implementation, passing acceptance, SQL import or execution readiness.'}
print(json.dumps(result,indent=2));sys.exit(1 if errors else 0)
