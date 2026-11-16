import { z } from 'zod';
import { ApplicationError, BrowserIdentitySchema, BrowserActorSchema, BrowserTargetSchema, BrowserCommandSchema, BrowserLeaseSchema, ProjectIdSchema, type BrowserControl } from '@devlab/contracts';

/** Transport adapter only; lifecycle, wire policy and ownership belong to plugins. */
export async function browserRequest(path:string,method:string|undefined,url:URL,body:()=>Promise<unknown>,browser:BrowserControl|undefined):Promise<unknown> {
  if(!browser)throw new ApplicationError('SERVICE_UNAVAILABLE','Browser capability is disabled in this profile');
  if(method==='GET'&&path==='/api/browsers')return browser.discover(ProjectIdSchema.parse(url.searchParams.get('projectId')));
  if(method==='GET'&&path==='/api/browsers/frame')return browser.frame(BrowserTargetSchema.parse(Object.fromEntries(url.searchParams)));
  if(method==='POST') {
    switch(path) {
      case '/api/browsers/start': {
        const input=BrowserIdentitySchema.extend({actor:BrowserActorSchema}).strict().parse(await body());
        return browser.start({projectId:input.projectId,browserId:input.browserId},input.actor);
      }
      case '/api/browsers/acquire': {
        const {actor,takeover,...target}=BrowserTargetSchema.extend({actor:BrowserActorSchema,takeover:z.boolean().default(false)}).strict().parse(await body());
        return browser.acquire(target,actor,takeover);
      }
      case '/api/browsers/command':return browser.command(BrowserCommandSchema.parse(await body()));
      case '/api/browsers/release':await browser.release(BrowserLeaseSchema.parse(await body()));return {ok:true};
      case '/api/browsers/clear': {
        const {actor,...identity}=BrowserIdentitySchema.extend({actor:BrowserActorSchema}).strict().parse(await body());
        await browser.clearProfile(identity,actor);return {ok:true};
      }
    }
  }
  throw new ApplicationError('NOT_FOUND','Browser command not found');
}
