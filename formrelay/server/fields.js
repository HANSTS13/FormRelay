// Only explicit field definitions cross the network; DOM identifiers stay local.
const types = new Set(['text', 'email', 'tel', 'number', 'date', 'textarea', 'select', 'radio', 'checkbox', 'checkbox-group']);
const sensitive = /password|passcode|one[\s_-]*time|otp|verification|security[\s_-]*code|\bauth(?:entication|orization)?\b|auth(?:code|key)|oauth|user[\s_-]*name|session|remember[\s_-]*me|csrf|xsrf|token|secret|credential|(?:cvv|cvc|card|credit|debit|payment|bank)|\b(?:pin|ssn|aadhaar|aadhar)\b|log[\s_-]*in|sign[\s_-]*in/i;
const keyPattern = /^[a-zA-Z0-9_-]{1,80}$/;
const forbidden = new Set(['__proto__', 'prototype', 'constructor']);
const text = (value, limit) => typeof value === 'string' && value.trim().length > 0 && value.length <= limit && !/[\u0000-\u001f]/.test(value);

function definitions(fields) {
  if (!Array.isArray(fields) || fields.length < 1 || fields.length > 20) throw Error('Select 1-20 fields');
  const keys = new Set();
  return fields.map(f => {
    if (!f || !keyPattern.test(f.key) || typeof f.key !== 'string' || forbidden.has(f.key) || keys.has(f.key) || !text(f.label, 1000) || !types.has(f.type) || sensitive.test(f.label.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_-]/g, ' '))) throw Error('Unsupported, duplicate, or sensitive fields');
    keys.add(f.key);
    const result = {key: f.key, label: f.label, type: f.type};
    if ((f.type === 'checkbox'||f.type==='checkbox-group')) result.required = f.required === true;
    if (f.type === 'select' || f.type === 'radio' || f.type==='checkbox-group') {
      if (!Array.isArray(f.options) || !f.options.length || f.options.length > 50) throw Error('Select or radio fields need 1-50 choices');
      const values = new Set();
      result.options = f.options.map(option => {
        if (!option || typeof option.value !== 'string' || !keyPattern.test(option.value) || forbidden.has(option.value) || values.has(option.value) || !text(option.label, 500)) throw Error('Invalid choice definitions');
        values.add(option.value);
        return {value: option.value, label: option.label,...(option.other===true?{other:true}:{})};
      });
    }
    return result;
  });
}

function validateAnswers(fields, incoming) {
  if (!incoming || typeof incoming !== 'object' || Array.isArray(incoming) || Object.keys(incoming).length !== fields.length || Object.keys(incoming).some(key => !fields.some(f => f.key === key))) throw Error('Unexpected or missing answer fields');
  const answers = Object.create(null);
  for (const f of fields) {
    const raw = incoming[f.key];
    const structured=raw&&typeof raw==='object'&&!Array.isArray(raw);
    const v=structured?raw.value:raw;
    if(structured){
      if(!f.options?.some(o=>o.other)||Object.keys(raw).some(k=>!['value','other'].includes(k))||!raw.other||typeof raw.other!=='object'||Array.isArray(raw.other))throw Error('Invalid Other answer');
    }
    const selected=f.type==='checkbox-group'?v:[v];
    const custom=f.options?.filter(o=>o.other&&Array.isArray(selected)&&selected.includes(o.value))||[];
    if(custom.length||structured){
      if(!structured||Object.keys(raw.other).length!==custom.length||Object.keys(raw.other).some(k=>!custom.some(o=>o.value===k))||custom.some(o=>!text(raw.other[o.value],500)))throw Error('Specify text for each selected Other option');
    }
    if(f.type==='checkbox-group'){
      if(!Array.isArray(v)||new Set(v).size!==v.length||v.length>50||v.some(value=>typeof value!=='string'||!f.options?.some(o=>o.value===value))||(f.required&&!v.length))throw Error('Invalid checkbox choices');
    } else if (f.type === 'checkbox') {
      if (typeof v !== 'boolean' || (f.required && !v)) throw Error('Invalid checkbox answer');
    } else {
      if (typeof v !== 'string' || !v.trim() || v.length > 500 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(v)) throw Error('Invalid answer');
      if (f.type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) throw Error('Invalid email');
      if (f.type === 'number' && !Number.isFinite(Number(v))) throw Error('Invalid number');
      if (f.type === 'tel' && !/^[+()0-9 .-]{3,40}$/.test(v)) throw Error('Invalid phone');
      if (f.type === 'date' && (!/^\d{4}-\d{2}-\d{2}$/.test(v) || !Number.isFinite(Date.parse(v)) || new Date(v).toISOString().slice(0, 10) !== v)) throw Error('Invalid date');
      if ((f.type === 'select' || f.type === 'radio') && !f.options?.some(option => option.value === v)) throw Error('Answer is not an offered choice');
    }
    answers[f.key] = structured ? {value:v,other:Object.fromEntries(custom.map(o=>[o.value,raw.other[o.value]]))} : v;
  }
  return answers;
}
module.exports = {definitions, validateAnswers};
