import fs from 'fs'; import yaml from 'js-yaml';
const doc = yaml.load(fs.readFileSync('public/vocab/verbs.yml','utf8'));
const out=[];
for(const [k,w] of Object.entries(doc.words||{})){
  const g=(w.en_gb&&w.en_gb.standard)||k.split('=')[1]||'';
  const c=(w.collections||[]).join(',');
  out.push(k+' :: '+g+' :: ['+c+']');
}
console.error('TOTAL '+out.length);
console.log(out.join('\n'));
