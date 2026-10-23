import {LiaraObservability} from './liara.js';
import {LiaraNetworks,NetworkOperations} from './networks.js';
import {ApplicationCreations,LiaraApplicationCreation} from './application-creations.js';
import {LiaraDeployment} from './deployment.js';
import type {Store} from './store.js';
import {validatedScope,type AccountScope} from './liara-scope.js';
export type ScopedServices={liara:LiaraObservability;networks:NetworkOperations;applicationCreations:ApplicationCreations;deployment:LiaraDeployment};
/** Credentials stay in backend closures. No new service becomes active before authenticated scope verification. */
export function scopeSelector(token:string|undefined,store:Store,fetcher?:typeof fetch,health:{healthOrigin?:string;healthAppId?:string}={}){
 return async(input:AccountScope):Promise<ScopedServices>=>{
  if(!token)throw new Error('Not configured');const scope=validatedScope(input);
  const liara=new LiaraObservability(token,{scope,fetch:fetcher});await liara.connect();
  return {liara,networks:new NetworkOperations(store,new LiaraNetworks({token,scope,fetch:fetcher,verifiedAccountId:liara.status().account!.id})),applicationCreations:new ApplicationCreations(store,new LiaraApplicationCreation({token,scope,fetch:fetcher})),deployment:new LiaraDeployment({token,scope,fetch:fetcher,...health})};
 };
}
