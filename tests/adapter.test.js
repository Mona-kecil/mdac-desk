import { describe, it, expect, afterEach } from 'vitest';
import { JSDOM } from 'jsdom';
import { createAdapter, assertArrival, formValues } from '../remote/adapter.js';

const submission = () => ({ id: 'test-attempt', state: 'queued', profileSnapshot: { name: 'TEST PERSON', passportNo: '0001234', birthDate: '1990-01-02', nationality: 'IDN', birthPlace: 'IDN', sex: '1', passportExpiry: '2030-01-02', email: 'test@example.invalid', phoneCountry: '62', phone: '0012345678' }, tripSnapshot: { arrival: '2026-10-15', departure: '2026-10-17', transportNo: 'TEST 1', travelMode: '1', embarkation: 'IDN', accommodationKind: '01', address1: 'TEST HOTEL ROAD', address2: '', state: '14', city: 'KUL', postcode: '05000' } });
const opened = [];
afterEach(() => opened.splice(0).forEach(dom => dom.window.close()));
function fixture({ stale = false, brokenCity = false, name = 'TEST PERSON', now = () => new Date('2026-10-15T10:00:00Z') } = {}) {
  const dom = new JSDOM('<form></form>', { url: 'http://localhost/fixture.html' }); opened.push(dom);
  const document = dom.window.document;
  const payload = submission(); payload.profileSnapshot.name = name;
  const values = formValues(payload);
  const selects = new Set(['nationality','pob','sex','region','trvlMode','embark','accommodationStay','accommodationState','accommodationCity']);
  const form = document.querySelector('form');
  for (const [id,value] of Object.entries(values)) {
    const element = document.createElement(selects.has(id) ? 'select' : 'input'); element.id = id;
    if (selects.has(id)) element.innerHTML = `<option value="">Pilih</option><option value="${value}">${value}</option>`;
    form.append(element);
  }
  form.insertAdjacentHTML('beforeend', `<div id="captcha"><div class="sliderContainer ${stale ? 'sliderContainer_success' : ''}"><div class="slider">Drag</div></div></div><input id="submit" type="submit">`);
  for (const id of ['nationality','pob']) document.getElementById(id).addEventListener('change', () => setTimeout(() => {document.getElementById('region').innerHTML = '<option value="60">Default</option><option value="62">Indonesia</option>';}, 5));
  document.getElementById('accommodationState').addEventListener('change', () => setTimeout(() => {document.getElementById('accommodationCity').innerHTML = brokenCity ? '<option value="OTHER">Other</option>' : '<option value="KUL">Kuala Lumpur</option>';}, 5));
  document.getElementById('accommodationCity').addEventListener('change', () => setTimeout(() => {document.getElementById('accommodationPostcode').outerHTML = '<input id="accommodationPostcode" value="50000">';}, 5));
  const events = []; let authorized = 0;
  const adapter = createAdapter({document,submission:payload,now,dependencyTimeout:100,emit:async(type,detail)=>events.push({type,detail}),authorizeClick:async()=>{authorized++;}});
  return {document,adapter,events,get authorized(){return authorized;}};
}

describe('official adapter', () => {
  it('fills official IDs, waits for dependent replacements and preserves zeros', async () => {
    const test = fixture(); await test.adapter.start();
    expect(test.events.map(event=>event.type)).toEqual(['filling','awaiting_verification']);
    const read = id => test.document.getElementById(id).value;
    expect([read('passNo'),read('mobile'),read('accommodationPostcode'),read('region'),read('accommodationCity'),read('dob'),read('confirmEmail')]).toEqual(['0001234','0012345678','05000','62','KUL','02/01/1990','test@example.invalid']);
    expect(()=>test.adapter.readback()).not.toThrow();
    expect(test.document.getElementById('submit').disabled).toBe(false);
    expect(test.authorized).toBe(0);
  });
  it('blocks when the loaded city does not contain the requested code', async () => {
    const test=fixture({brokenCity:true}); await test.adapter.start();
    expect(test.events.at(-1).type).toBe('blocked');
    expect(test.events.at(-1).detail).toContain('accommodationCity');
    expect(test.authorized).toBe(0);
  });
  it('rejects silent field changes during readback', async () => {
    const test=fixture(); await test.adapter.start(); test.document.getElementById('mobile').value='999';
    expect(()=>test.adapter.readback()).toThrow('mobile');
  });
  it('does not treat a stale success class as verification', async () => {
    const test=fixture({stale:true}); await test.adapter.start();
    test.document.getElementById('submit').setAttribute('data-change','1');
    await new Promise(resolve=>setTimeout(resolve,5));
    expect(test.adapter.phase).toBe('awaiting_verification'); expect(test.authorized).toBe(0);
  });
  it('rejects synthetic gestures even with a subsequent success class', async () => {
    const test=fixture(); await test.adapter.start(); const win=test.document.defaultView;
    const slider=test.document.querySelector('.slider');
    for(const [type,x] of [['pointerdown',0],['pointermove',100],['pointerup',100]]) slider.dispatchEvent(new win.MouseEvent(type,{bubbles:true,clientX:x}));
    test.document.querySelector('.sliderContainer').classList.add('sliderContainer_success');
    await new Promise(resolve=>setTimeout(resolve,5));
    expect(test.authorized).toBe(0); expect(test.adapter.phase).toBe('awaiting_verification');
  });
  it('accepts the official uppercase transform and rejects official length limits', async () => {
    const test=fixture({name:'Test Person'});
    test.document.getElementById('name').classList.add('uppercase');
    await test.adapter.start();
    expect(test.document.getElementById('name').value).toBe('TEST PERSON');
    const invalid=submission(); invalid.profileSnapshot.passportNo='1234567890123';
    expect(()=>formValues(invalid)).toThrow('batas resmi 12');
  });
  it('checks the arrival window again after filling', async () => {
    let time=new Date('2026-10-15T10:00:00Z');
    const test=fixture({now:()=>time}); await test.adapter.start();
    time=new Date('2026-10-18T10:00:00Z');
    expect(()=>test.adapter.readback()).toThrow('kedatangan');
  });
  it('blocks when a dependency never replaces its options', async () => {
    const test=fixture();
    const country=test.document.getElementById('nationality'); country.replaceWith(country.cloneNode(true));
    await test.adapter.start();
    expect(test.events.at(-1).type).toBe('blocked');
    expect(test.events.at(-1).detail).toContain('belum dimuat');
  });
  it('checks the Malaysian date boundary and upper limit', () => {
    expect(()=>assertArrival('2026-10-15',new Date('2026-10-14T15:59:59Z'))).not.toThrow();
    expect(()=>assertArrival('2026-10-14',new Date('2026-10-14T16:00:00Z'))).toThrow();
    expect(()=>assertArrival('2026-10-17',new Date('2026-10-14T16:00:00Z'))).not.toThrow();
    expect(()=>assertArrival('2026-10-18',new Date('2026-10-14T16:00:00Z'))).toThrow();
  });
  it('rejects impossible dates and addresses with fewer than three words', () => {
    const invalid=submission(); invalid.profileSnapshot.birthDate='1990-02-30'; expect(()=>formValues(invalid)).toThrow('Tanggal');
    const short=submission(); short.tripSnapshot.address1='TEST HOTEL'; expect(()=>formValues(short)).toThrow('tiga kata');
  });
});
