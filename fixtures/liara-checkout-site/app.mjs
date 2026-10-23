// Deliberately broken descendant of the Phase 4 missing-input fixture. Do not repair yet.
export function respond(input){
 const url=new URL(input);
 if(url.pathname==='/')return {status:200,body:'وب‌سایت آزمایشی Liara Copilot'};
 if(url.pathname==='/health')return {status:200,body:'ok'};
 if(url.pathname==='/api/checkout'){
  try{
   const coupon=url.searchParams.get('coupon').trim(); // Genuine TypeError when optional coupon is absent.
   return {status:200,body:JSON.stringify({ok:true,coupon})};
  }catch{
   console.error(JSON.stringify({level:'error',event:'checkout_failed',code:'CHECKOUT_COUPON_MISSING',path:'/api/checkout'}));
   return {status:500,body:'checkout failed — test baseline'};
  }
 }
 return {status:404,body:'not found'};
}
