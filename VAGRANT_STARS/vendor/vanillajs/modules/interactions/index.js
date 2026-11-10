// SPDX-License-Identifier: Apache-2.0
const scalar=value=>value===null || typeof value==='string' || typeof value==='boolean' || (typeof value==='number' && Number.isFinite(value));
const record=value=>value!==null && typeof value==='object' && !Array.isArray(value);
function text(value,name) {
  if (typeof value!=='string' || !value) throw new TypeError(`${name} must be a nonempty string`);
  return value;
}
function reason(value) {
  if (!record(value)) throw new TypeError('reason must contain code and message');
  return {code:text(value.code,'reason code'),message:text(value.message,'reason message')};
}

/** Compile an owned snapshot of declarative rules. No callbacks or code strings.
 * Highest priority, then ascending id wins. A matching rule whose requirements
 * fail blocks; it never falls through to a lower-priority rule.
 */
export function createInteractionResolver(rules) {
  if (!Array.isArray(rules)) throw new TypeError('rules must be an array');
  const ids=new Set();
  const compiled=rules.map(rule=>{
    if (!record(rule)) throw new TypeError('invalid rule');
    const id=text(rule.id,'rule id');
    if (ids.has(id)) throw new TypeError('duplicate rule id');
    ids.add(id);
    const priority=rule.priority??0, outcome=rule.outcome??'applied';
    if (!Number.isSafeInteger(priority) || !['applied','resisted'].includes(outcome)) throw new TypeError('invalid rule priority or outcome');
    const match={source:text(rule.match?.source,'source kind'),target:text(rule.match?.target,'target kind')};
    if (!Array.isArray(rule.requires??[]) || !Array.isArray(rule.effects??[])) throw new TypeError('requires and effects must be arrays');
    const requires=(rule.requires??[]).map(condition=>{
      if (!record(condition) || !['source','target','context'].includes(condition.scope) || !scalar(condition.equals)) {
        throw new TypeError('invalid rule condition');
      }
      return {scope:condition.scope,key:text(condition.key,'condition key'),equals:condition.equals,...reason(condition)};
    });
    const effects=(rule.effects??[]).map(effect=>{
      if (!record(effect) || !Object.values(effect).every(scalar)) throw new TypeError('effects must be flat scalar records');
      text(effect.type,'effect type');return {...effect};
    });
    if (outcome==='resisted' && effects.length) throw new TypeError('resisted rules cannot emit effects');
    return {id,priority,match,requires,effects,outcome,reason:reason(rule.reason)};
  }).sort((a,b)=>b.priority-a.priority || (a.id<b.id?-1:a.id>b.id?1:0));
  return Object.freeze({
    evaluate({source,target,context={}}={}) {
      if (!record(source) || !record(target) || !record(context)) throw new TypeError('interaction inputs must be records');
      text(source.kind,'source kind');text(target.kind,'target kind');
      const rule=compiled.find(r=>r.match.source===source.kind && r.match.target===target.kind);
      if (!rule) return {status:'unmatched',ruleId:null,effects:[],reasons:[{code:'no-rule',message:'No rule matches this source and target.'}]};
      const inputs={source,target,context};
      const missing=rule.requires.filter(c=>!Object.hasOwn(inputs[c.scope],c.key) || inputs[c.scope][c.key]!==c.equals);
      if (missing.length) return {status:'blocked',ruleId:rule.id,effects:[],reasons:missing.map(({code,message})=>({code,message}))};
      return {status:rule.outcome,ruleId:rule.id,effects:rule.effects.map(e=>({...e})),reasons:[{...rule.reason}]};
    }
  });
}
