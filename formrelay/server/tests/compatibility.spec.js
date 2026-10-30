const {test, expect} = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const extension = path.join(__dirname, '../../extension');
async function command(page, action, extra = {}) {
  return page.evaluate(({action, extra}) => new Promise(resolve => receive({action, ...extra}, null, resolve)), {action, extra});
}
async function setup(page, html) {
  await page.goto('/demo');
  if (html) await page.locator('body').evaluate((body, html) => {body.innerHTML = html;}, html);
  await page.evaluate(() => {
    window.submissions = 0; window.lastStatus = '';
    document.addEventListener('submit', () => submissions++);
    window.chrome = {storage: {local: {set: data => {if (data.formrelayStatus) lastStatus = data.formrelayStatus;}}}, runtime: {lastError: null, onMessage: {addListener: fn => window.receive = fn}, sendMessage: async (msg, callback) => {
      if(msg.action!=='FETCH'){if(msg.action==='STATE_UPDATE')lastStatus=msg.state.status;callback({ok:true});return;}
      const response = await fetch(msg.path, {headers: {Authorization: 'Bearer ' + msg.token}}); callback({ok: response.ok, data: await response.json()});
    }}};
  });
  await page.route('**/__test/content.js', route => route.fulfill({contentType: 'application/javascript', body: fs.readFileSync(path.join(extension, 'content.js'), 'utf8')}));
  await page.addScriptTag({url: '/__test/content.js'});
}
async function requestFor(page, request) {
  await command(page, 'STOP');
  const {fields, issues} = await command(page, 'GET_SELECTION'); expect(issues).toEqual([]);
  const response = await request.post('/api/requests', {data: {fields}}); expect(response.status()).toBe(201);
  const created = await response.json();
  await command(page, 'TRACK', {track: {base: 'http://localhost:3108', id: created.id, token: created.ownerToken}});
  return {...created, fields};
}
async function answer(request, created, values) {
  const response = await request.post('/api/requests/' + created.id + '/answer', {data: {answers: Object.fromEntries(created.fields.map(f => [f.key, values[f.label]]))}});
  expect(response.status()).toBe(200);
}
test('native inputs, textarea, select, radio group and both checkbox answers complete the recipient workflow', async ({page, context, request}) => {
  await setup(page, `<form id="application">
    <label for="name">Full name</label><div><input id="name" name="person"></div>
    <label>Email address<input id="email" type="email"></label><label>Phone<input id="phone" type="tel"></label>
    <label>Dependents<input id="count" type="number"></label><label>Start date<input id="date" type="date"></label>
    <label>Biography<textarea id="bio"></textarea></label>
    <label>Country<select id="country"><option value="">Choose</option><option value="CA">Canada</option><option value="IN">India</option></select></label>
    <fieldset><legend>Preferred contact</legend><label>Email<input id="contact-email" type="radio" name="contact" value="email"></label><label>Telephone<input id="contact-phone" type="radio" name="contact" value="phone"></label></fieldset>
    <label>Send updates<input id="updates" type="checkbox"></label><label>Receive reminders<input id="reminders" type="checkbox"></label>
    <label>Existing answer<input id="existing" value="Keep this answer"></label><button>Submit original</button></form>`);
  await command(page, 'START');
  await page.locator('label[for=name]').click();
  for (const id of ['email','phone','count','date','bio','country','contact-email','updates','reminders']) await page.locator('#' + id).click();
  await page.locator('#contact-phone').click(); // Either member toggles the same selected radio group.
  expect((await command(page, 'GET_SELECTION')).fields).toHaveLength(9);
  await page.locator('#contact-email').click();
  await expect(page.locator('#updates')).not.toBeChecked(); await expect(page.locator('#reminders')).not.toBeChecked(); await expect(page.locator('#contact-email')).not.toBeChecked();
  const created = await requestFor(page, request); expect(created.fields).toHaveLength(10);
  expect(JSON.stringify(created.fields)).not.toContain('Keep this answer'); expect(JSON.stringify(created.fields)).not.toContain('"CA"');
  const recipient = await context.newPage(); await recipient.goto(created.url);
  await recipient.getByLabel('Full name').fill('Morgan Example'); await recipient.getByLabel('Email address').fill('morgan@example.test'); await recipient.getByLabel('Phone', {exact: true}).fill('555-0100');
  await recipient.getByLabel('Dependents').fill('2'); await recipient.getByLabel('Start date').fill('2026-11-01'); await recipient.getByLabel('Biography').fill('Fictional multi-line\nbiography');
  await recipient.getByLabel('Country').selectOption({label: 'Canada'}); await recipient.getByLabel('Telephone', {exact: true}).check(); await recipient.getByLabel('Send updates').check();
  await recipient.getByRole('button', {name: 'Send answers'}).click(); await expect(recipient.locator('#status')).toContainText('Submitted!');
  await expect.poll(() => page.evaluate(() => lastStatus)).toContain('10/10 fields verified');
  await expect(page.locator('#name')).toHaveValue('Morgan Example'); await expect(page.locator('#bio')).toHaveValue('Fictional multi-line\nbiography'); await expect(page.locator('#country')).toHaveValue('CA');
  await expect(page.locator('#contact-phone')).toBeChecked(); await expect(page.locator('#contact-email')).not.toBeChecked(); await expect(page.locator('#updates')).toBeChecked(); await expect(page.locator('#reminders')).not.toBeChecked();
  await expect(page.locator('#existing')).toHaveValue('Keep this answer'); expect(await page.evaluate(() => submissions)).toBe(0);
  await page.locator('#name').fill('Later manual edit'); await command(page, 'UNDO');
  await expect(page.locator('#name')).toHaveValue('Later manual edit'); await expect(page.locator('#country')).toHaveValue(''); await expect(page.locator('#updates')).not.toBeChecked();
});

test('dynamic fields and duplicate labels/names keep exact mappings; replacements need explicit confirmation', async ({page, request}) => {
  await setup(page, '<form id="first"><label>Address<input name="address"></label></form><form id="second"><button id="add" type="button">Add address</button></form>');
  await page.locator('#add').evaluate(button => button.addEventListener('click', () => button.parentElement.insertAdjacentHTML('beforeend', '<div role="listitem"><div role="heading" id="address-label">Address</div><input name="address" aria-labelledby="address-label"></div>')));
  await command(page, 'START');
  await page.locator('#add').click();
  await expect(page.locator('#second input')).toHaveCSS('outline-style', 'dashed');
  const report = await command(page, 'CHECK'); expect(report.duplicates).toBe(2);
  await page.locator('#second input').click(); const created = await requestFor(page, request);
  await page.locator('#second input').evaluate(el => {el.outerHTML = '<input name="address" aria-labelledby="address-label">';});
  await answer(request, created, {Address: 'Fictional second address'});
  await expect.poll(async () => (await command(page, 'CHECK')).selected[0].state).toBe('confirmation');
  await expect(page.locator('#first input')).toHaveValue(''); await expect(page.locator('#second input')).toHaveValue('');
  const confirm = await command(page, 'CONFIRM_MAPPING', {key: created.fields[0].key}); expect(confirm.ok).toBe(true);
  await page.locator('#second input').click();
  await expect.poll(async () => (await command(page, 'CHECK')).selected[0].state).toBe('verified');
  await expect(page.locator('#second input')).toHaveValue('Fictional second address'); await expect(page.locator('#first input')).toHaveValue('');
});

test('compatibility rejects credential, hidden and unsupported controls, allows filled fields; changed choices are never guessed', async ({page, request}) => {
  await setup(page, `<form id="login"><label>Password<input type="password"></label><label>Account email<input type="email"></label></form><form id="safe"><label>Login token<input name="access_token"></label><label>One time code<input autocomplete="one-time-code"></label><label>Payment<input autocomplete="cc-number"></label><input type="hidden" name="hidden">
    <label>Already filled<input value="Do not upload"></label><label>Multiple<select multiple><option>A</option></select></label><label>Shipping address<textarea></textarea></label>
    <label>Country<select id="country"><option value="">Choose</option><option value="CA">Canada</option></select></label></form><div role="combobox">Custom widget<input aria-label="Custom dropdown"></div><iframe title="Unsupported frame"></iframe>`);
  await command(page, 'START'); const report = await command(page, 'CHECK'); expect(report.custom).toBe(1); expect(report.frames).toBe(1);
  expect(report.fields.filter(f => f.supported).map(f => f.label)).toEqual(['Already filled','Shipping address','Country']);
  for (const field of report.fields.filter(f => !f.supported)) expect(field.reason.length).toBeGreaterThan(0);
  await page.locator('#country').click(); const created = await requestFor(page, request);
  await page.locator('#country option[value=CA]').evaluate(option => {option.value = 'OTHER'; option.textContent = 'Another choice';});
  await answer(request, created, {Country: 'choice_0'});
  await expect.poll(async () => (await command(page, 'CHECK')).selected[0].state).toBe('confirmation'); await expect(page.locator('#country')).toHaveValue('');
  await command(page, 'CONFIRM_MAPPING', {key: created.fields[0].key}); await page.locator('#country').click(); await expect(page.locator('#country')).toHaveValue('');
});

test('real React controlled text, textarea, select, radio and checkbox retain their state after rerender', async ({page, request}) => {
  await setup(page, '<div id="root"></div>');
  for (const [name, file] of [['react','react.development.js'],['react-dom','react-dom.development.js']]) {
    const directory = path.dirname(require.resolve(name + '/package.json'));
    await page.route('**/__test/' + name + '.js', route => route.fulfill({contentType: 'application/javascript', body: fs.readFileSync(path.join(directory, 'umd', file), 'utf8')}));
    await page.addScriptTag({url: '/__test/' + name + '.js'});
  }
  await page.evaluate(() => {
    function App() {
      const [state, setState] = React.useState({name:'',bio:'',country:'',contact:'',updates:false});
      const [, rerender] = React.useState(0);
      window.rerender = () => rerender(value => value + 1);
      React.useEffect(() => {window.reactState = state;});
      const h = React.createElement;
      const change = key => event => setState(old => ({...old,[key]:event.target.type === 'checkbox' ? event.target.checked : event.target.value}));
      return h('form',{id:'profile',onSubmit:event=>event.preventDefault()},
        h('label',null,'Full name',h('input',{id:'name',value:state.name,onChange:change('name')})),
        h('label',null,'Biography',h('textarea',{id:'bio',value:state.bio,onChange:change('bio')})),
        h('label',null,'Country',h('select',{id:'country',value:state.country,onChange:change('country')},h('option',{value:''},'Choose'),h('option',{value:'CA'},'Canada'))),
        h('fieldset',null,h('legend',null,'Contact method'),...['email','phone'].map(value=>h('label',{key:value},value,h('input',{type:'radio',name:'contact',value,checked:state.contact===value,onChange:change('contact')})))),
        h('label',null,'Send updates',h('input',{id:'updates',type:'checkbox',checked:state.updates,onChange:change('updates')})));
    }
    ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(App));
  });
  await expect(page.locator('#name')).toBeVisible(); await command(page, 'START');
  for (const selector of ['#name','#bio','#country','input[value=phone]','#updates']) await page.locator(selector).click();
  const created = await requestFor(page, request); await answer(request, created, {'Full name':'Morgan Example',Biography:'Fictional biography',Country:'choice_0','Contact method':'choice_1','Send updates':true});
  await expect.poll(() => page.evaluate(() => lastStatus)).toContain('5/5 fields verified');
  expect(await page.evaluate(() => reactState)).toEqual({name:'Morgan Example',bio:'Fictional biography',country:'CA',contact:'phone',updates:true});
  await page.evaluate(() => rerender()); await expect(page.locator('#name')).toHaveValue('Morgan Example'); await expect(page.locator('#updates')).toBeChecked(); expect(await page.evaluate(() => submissions)).toBe(0);
});

test('page-rejected values are reported as failed; user edits made while waiting are preserved', async ({page, request}) => {
  await setup(page, '<label>Reverting field<input id="revert"></label><label>Edited field<input id="edited"></label>');
  await page.locator('#revert').evaluate(el => el.addEventListener('input', () => setTimeout(() => {el.value = '';}, 220)));
  await command(page, 'START'); await page.locator('#revert').click(); await page.locator('#edited').click();
  const created = await requestFor(page, request); await page.locator('#edited').fill('Keep my manual answer'); await answer(request, created, {'Reverting field':'Remote answer','Edited field':'Must not overwrite'});
  await expect.poll(async () => (await command(page, 'CHECK')).selected.map(f => f.state)).toEqual(['failed','overwrite']);
  await expect(page.locator('#revert')).toHaveValue(''); await expect(page.locator('#edited')).toHaveValue('Keep my manual answer'); await expect(page.locator('#revert')).toHaveCSS('outline-color','rgb(188, 36, 60)');
});


test('replacement checkboxes wait for native click cancellation and original length constraints are enforced', async ({page, request}) => {
  await setup(page, '<label>Send updates<input id="updates" type="checkbox"></label><label>Short answer<input id="short" maxlength="3"></label><label>Ambiguous choices<select><option value="">Choose</option><option value="same">A</option><option value="same">B</option></select></label>');
  await command(page, 'START');
  expect((await command(page, 'CHECK')).fields.find(f => f.label === 'Ambiguous choices').reason).toContain('Ambiguous');
  await page.locator('#updates').click(); await page.locator('#short').click(); const created = await requestFor(page, request);
  await page.locator('#updates').evaluate(el => {el.outerHTML = '<input id="updates" type="checkbox">';});
  await answer(request, created, {'Send updates':true,'Short answer':'Too long'});
  await expect.poll(async () => (await command(page, 'CHECK')).selected.map(f => f.state)).toEqual(['confirmation','failed']); await expect(page.locator('#short')).toHaveValue('');
  await command(page, 'CONFIRM_MAPPING', {key:created.fields[0].key}); await page.locator('#updates').click();
  await expect.poll(async () => (await command(page, 'CHECK')).selected[0].state).toBe('verified'); await expect(page.locator('#updates')).toBeChecked();
});


test('identical radio and checkbox names in different forms remain separate after DOM reordering', async ({page, request}) => {
  const fields = '<fieldset><legend>Relationship</legend><label>A<input type="radio" name="relation" value="a"></label><label>B<input type="radio" name="relation" value="b"></label></fieldset><label>Send updates<input type="checkbox" name="updates"></label>';
  await setup(page, '<form id="one">'+fields+'</form><form id="two">'+fields+'</form>');
  await command(page, 'START'); await page.locator('#two input[value=b]').click(); await page.locator('#two input[type=checkbox]').click();
  const created = await requestFor(page, request);
  await page.locator('#two').evaluate(form => form.parentElement.prepend(form));
  await answer(request, created, {Relationship:'choice_1','Send updates':true});
  await expect.poll(() => page.evaluate(() => lastStatus)).toContain('2/2 fields verified');
  await expect(page.locator('#two input[value=b]')).toBeChecked(); await expect(page.locator('#two input[type=checkbox]')).toBeChecked();
  await expect(page.locator('#one input[value=b]')).not.toBeChecked(); await expect(page.locator('#one input[value=a]')).not.toBeChecked(); await expect(page.locator('#one input[type=checkbox]')).not.toBeChecked();
});


test('logical native checkbox groups preserve multiple choices in recipient and source forms',async({page,context,request})=>{
 await setup(page,'<form><fieldset><legend>Interests</legend><label>Music<input type="checkbox" name="interests"></label><label>Art<input type="checkbox" name="interests"></label><label>Science<input type="checkbox" name="interests"></label></fieldset><label>Unselected<input id="keep" value="Keep this"></label></form>');
 await command(page,'START');await page.getByLabel('Music').click();expect((await command(page,'GET_SELECTION')).fields[0].type).toBe('checkbox-group');
 const created=await requestFor(page,request);const recipient=await context.newPage();await recipient.goto(created.url);await recipient.getByLabel('Music').check();await recipient.getByLabel('Science').check();await recipient.getByRole('button',{name:'Send answers'}).click();
 await expect.poll(()=>page.evaluate(()=>lastStatus)).toContain('1/1 fields verified');await expect(page.getByLabel('Music')).toBeChecked();await expect(page.getByLabel('Art')).not.toBeChecked();await expect(page.getByLabel('Science')).toBeChecked();await expect(page.locator('#keep')).toHaveValue('Keep this');
});
test('accessible ARIA checkboxes/radios activate real handlers and reject unsafe or inert widgets',async({page,request})=>{
 await setup(page,'<form><div role="group" aria-label="Activities"><div role="checkbox" tabindex="0" aria-checked="false" aria-label="Music">Music</div><div role="checkbox" tabindex="0" aria-checked="false" aria-label="Art">Art</div></div><div role="radiogroup" aria-label="Contact preference"><div role="radio" tabindex="0" aria-checked="false" aria-label="Email">Email</div><div role="radio" tabindex="-1" aria-checked="false" aria-label="Phone">Phone</div></div><div role="checkbox" tabindex="0" aria-checked="false" aria-label="Inert toggle">Inert toggle</div><button><span role="checkbox" tabindex="0" aria-checked="false" aria-label="Unsafe nested button">Unsafe</span></button></form>');
 await page.locator('[role=checkbox]').evaluateAll(nodes=>nodes.filter(node=>node.getAttribute('aria-label')!=='Inert toggle').forEach(node=>node.addEventListener('click',()=>node.setAttribute('aria-checked',String(node.getAttribute('aria-checked')!=='true')))));
 await page.locator('[role=radio]').evaluateAll(nodes=>nodes.forEach(node=>node.addEventListener('click',()=>nodes.forEach(other=>other.setAttribute('aria-checked',String(other===node))))));
 await command(page,'START');const report=await command(page,'CHECK');expect(report.fields.find(f=>f.label==='Unsafe nested button').supported).toBe(false);
 await page.getByRole('checkbox',{name:'Music',exact:true}).click();await page.getByRole('radio',{name:'Email',exact:true}).click();await page.getByRole('checkbox',{name:'Inert toggle'}).click();
 const created=await requestFor(page,request);await answer(request,created,{Activities:['choice_0'],'Contact preference':'choice_1','Inert toggle':true});
 await expect.poll(()=>page.evaluate(()=>lastStatus)).toContain('2/3 fields verified');await expect(page.getByRole('checkbox',{name:'Music',exact:true})).toBeChecked();await expect(page.getByRole('radio',{name:'Phone',exact:true})).toBeChecked();
 expect((await command(page,'CHECK')).selected.find(f=>f.label==='Inert toggle').state).toBe('failed');expect(await page.evaluate(()=>submissions)).toBe(0);
});
test('same-document steps defer hidden exact mappings and fill only when the original step returns',async({page,request})=>{
 await setup(page,'<form><section id="step"><label>Guardian name<input id="guardian"></label></section><section id="other"><label>Guardian name<input id="unrelated"></label></section></form>');
 await command(page,'START');await page.locator('#guardian').click();const created=await requestFor(page,request);await page.locator('#step').evaluate(el=>el.hidden=true);await answer(request,created,{'Guardian name':'Morgan Example'});
 await expect.poll(async()=>(await command(page,'CHECK')).selected[0].state).toBe('deferred');await expect(page.locator('#unrelated')).toHaveValue('');
 await page.locator('#step').evaluate(el=>el.hidden=false);await expect(page.locator('#guardian')).toHaveValue('Morgan Example');await expect.poll(async()=>(await command(page,'CHECK')).selected[0].state).toBe('verified');await expect(page.locator('#unrelated')).toHaveValue('');
});
test('Vue v-model accepts native text, select and checkbox state; Angular-style bindings receive events',async({page,request})=>{
 await setup(page,'<div id="vue-root"><label>Full name<input id="vue-name" v-model="name"></label><label>Country<select id="vue-country" v-model="country"><option value="">Choose</option><option value="CA">Canada</option></select></label><label>Send updates<input id="vue-updates" type="checkbox" v-model="updates"></label></div><label>Angular-style name<input id="angular-name"></label>');
 const directory=path.dirname(require.resolve('vue/package.json'));
 await page.route('**/__test/vue.js',route=>route.fulfill({contentType:'application/javascript',body:fs.readFileSync(path.join(directory,'dist/vue.global.js'),'utf8')}));await page.addScriptTag({url:'/__test/vue.js'});
 await page.evaluate(()=>{window.vueState=Vue.reactive({name:'',country:'',updates:false});Vue.createApp({setup(){const h=Vue.h;return()=>h('div',null,[h('label',null,['Full name',Vue.withDirectives(h('input',{id:'vue-name','onUpdate:modelValue':value=>vueState.name=value}),[[Vue.vModelText,vueState.name]])]),h('label',null,['Country',Vue.withDirectives(h('select',{id:'vue-country','onUpdate:modelValue':value=>vueState.country=value},[h('option',{value:''},'Choose'),h('option',{value:'CA'},'Canada')]),[[Vue.vModelSelect,vueState.country]])]),h('label',null,['Send updates',Vue.withDirectives(h('input',{id:'vue-updates',type:'checkbox','onUpdate:modelValue':value=>vueState.updates=value}),[[Vue.vModelCheckbox,vueState.updates]])])])}}).mount('#vue-root');window.angularStyleState='';document.getElementById('angular-name').addEventListener('input',event=>{angularStyleState=event.target.value});});
 await command(page,'START');for(const id of ['vue-name','vue-country','vue-updates','angular-name'])await page.locator('#'+id).click();const created=await requestFor(page,request);await answer(request,created,{'Full name':'Morgan Example',Country:'choice_0','Send updates':true,'Angular style name':'Fictional Angular fixture'});
 await expect.poll(()=>page.evaluate(()=>lastStatus)).toContain('4/4 fields verified');expect(await page.evaluate(()=>({...vueState}))).toEqual({name:'Morgan Example',country:'CA',updates:true});expect(await page.evaluate(()=>angularStyleState)).toBe('Fictional Angular fixture');
});
