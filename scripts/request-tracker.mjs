import {ID, escapeHTML as esc} from './core.mjs';
import {option} from './dialogs.mjs';
import {requestStatus, remindOutstanding, reconcileResponses} from './requests.mjs';

export class RequestTracker extends foundry.applications.api.ApplicationV2 {
  static DEFAULT_OPTIONS = {id:'gcs-request-tracker', tag:'section', classes:['gcs-window','gcs-tracker-window'],
    window:{title:'Player roll requests',icon:'fa-solid fa-list-check',resizable:true},position:{width:640,height:470}};
  refresh() {
    clearTimeout(this._refreshTimer);
    this._refreshTimer=setTimeout(()=>{if(this.rendered && !this.busy)this.render({force:true});},150);
  }
  async _prepareContext() {
    if (!game.user.isGM) throw new Error('Only a GM can track requests.');
    const requests=Array.from(game.messages.values()).filter(m=>m.author?.isGM && m.getFlag(ID,'requestData')?.version===1 && !m.getFlag(ID,'requestData').source)
      .sort((a,b)=>(b.timestamp||0)-(a.timestamp||0));
    const message=requests.find(m=>m.id===this.requestId)||requests[0];
    this.requestId=message?.id;
    return {requests,message,status:message?await requestStatus(message):[]};
  }
  async _renderHTML({requests,message,status}) {
    const root=document.createElement('div');root.className='gcs-root gcs-tracker';
    const payload=message?.getFlag(ID,'requestData');
    root.innerHTML=`<div class="gcs-tracker-heading"><p>Track completion without opening each result.</p><button type="button" data-tracker="refresh">Refresh</button></div>
      ${requests.length?`<label class="gcs-field"><span>Request</span><select data-tracker-request>${requests.map(m=>option(m.id,`${m.getFlag(ID,'requestData').shortcut.label} · ${new Date(m.timestamp||0).toLocaleString()} · ${m.author.name}`,m.id===message.id)).join('')}</select></label>
      <p class="gcs-hint">${esc(payload.instruction||'')}${payload.instruction?'  ·  ':''}${payload.mode==='publicroll'?'Public results':'Results visible only to GMs'}</p>
      <div class="gcs-tracker-list"><table class="gcs-results-table"><thead><tr><th>Character</th><th>Status</th><th>Details</th></tr></thead><tbody>${status.map(r=>`<tr><td>${esc(r.name)}</td><td><span class="gcs-request-state ${r.status==='Rolled'?'gcs-done':''}">${esc(r.status)}</span></td><td>${esc(r.detail)}</td></tr>`).join('')}</tbody></table></div>
      <div class="gcs-tracker-footer"><span>${status.filter(r=>r.status==='Rolled').length} of ${status.length} rolled · ${status.filter(r=>r.status==='Awaiting roll').length} awaiting</span><button type="button" data-tracker="remind" ${this.busy||!status.some(r=>r.status==='Awaiting roll')?'disabled':''}>Remind outstanding</button></div>
      <p class="gcs-hint">Reminders include only available characters awaiting a roll, with the original adjustments and audience.  Offline owners can respond later.  Keep the original request in chat to retain tracking.</p>`:
      '<div class="gcs-empty"><h3>No roll requests yet</h3><p>Use Request rolls on the control sheet.  Requests still in chat appear here.</p></div>'}`;
    return root;
  }
  _replaceHTML(result, content) {
    const scroll=content.querySelector('.gcs-tracker-list')?.scrollTop||0;
    content.replaceChildren(result);result.querySelector('.gcs-tracker-list')?.scrollTo(0,scroll);
    result.querySelector('[data-tracker-request]')?.addEventListener('change',e=>{this.requestId=e.target.value;this.render({force:true});});
    result.addEventListener('click',async e=>{
      const action=e.target.closest('[data-tracker]')?.dataset.tracker;if(!action||this.busy)return;
      this.busy=true;
      try {
        if(action==='remind') {e.target.disabled=true;await remindOutstanding(game.messages.get(this.requestId));ui.notifications.info('Reminder sent to outstanding owners.');}
        else await reconcileResponses();
      } catch(error) {ui.notifications.error(error.message);console.error(`${ID} | Request tracker`,error);}
      finally {this.busy=false;await this.render({force:true});}
    });
  }
}
