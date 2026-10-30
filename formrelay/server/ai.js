// Aibin's assistance feature uses local rules, not a model or external API.
// Keep unknown wording intact; never infer a question's meaning from its type alone.
const rules = [
  {match:/\b(?:annual|yearly)\b.*\b(?:income|remuneration|earnings)\b|\b(?:income|remuneration|earnings)\b.*\b(?:annual|yearly)\b/i, title:'Yearly income', hint:'Use the period, currency and household scope stated in the original question. Do not enter account credentials.', example:'850000'},
  {match:/\bsurname\b.*\bgiven\b|\bgiven\b.*\bsurname\b/i, title:'Full name', hint:'Follow the name format requested by the original form; do not include identity-document numbers.', example:'Morgan Example'},
  {match:/\b(?:kinship|custodial affiliation|relationship)\b/i, title:'Relationship', hint:'Choose only from the offered relationships. Use the original question to identify whose relationship is requested.'},
  {match:/\b(?:vocation|occupation|professional livelihood)\b/i, title:'Occupation', hint:'Describe the work requested by the original question.', example:'Fictional Teacher'},
  {match:/\b(?:date of birth|birth date|dob|nativity)\b/i, title:'Date of birth', hint:'Use the date requested by the original form. Check the displayed date format.'}
];
function simplifyField(field) {
  const original=String(field.label||'').trim();
  const candidate=!['radio','checkbox','checkbox-group','select'].includes(field.type)
    ? rules.find(item=>item.match.test(original))
    : field.type==='select' ? rules.find(item=>item.title==='Relationship'&&item.match.test(original)) : null;
  const rule=candidate&&(!['number','date'].includes(field.type)||field.type==='number'&&candidate.title==='Yearly income'||field.type==='date'&&candidate.title==='Date of birth')?candidate:null;
  let hint=rule?.hint;
  if(!hint){
    if(field.options)hint='Choose only the offered options. If an Other text box appears, specify your answer there.';
    else if(field.type==='tel')hint='Follow the phone format in the original question, including a country code only when requested.';
    else if(field.type==='email')hint='Enter the email address requested by the original question.';
    else if(field.type==='number')hint='Enter a number using the units and period in the original question.';
    else if(field.type==='date')hint='Enter the date requested by the original question; this may not be a date of birth.';
    else hint='Answer the original question. This local helper cannot verify whether an answer is factually correct.';
  }
  return {...field,originalLabel:original,simplifiedLabel:rule?rule.title:original,aiHint:hint,
    isSimplified:!!rule&&original!==rule.title,assistanceSource:'local-rules',...(rule?.example?{exampleValue:rule.example}:{})};
}
const enhanceFieldsWithAI=fields=>Array.isArray(fields)?fields.map(simplifyField):[];
module.exports={simplifyField,enhanceFieldsWithAI};
