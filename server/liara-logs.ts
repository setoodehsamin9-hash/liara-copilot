import {z} from 'zod';

const entry = z.object({_entry:z.string().max(1_048_576),type:z.string().max(100)});
const response = z.object({data:z.array(z.object({
  metaData:z.object({releaseId:z.string().regex(/^[A-Za-z0-9_-]{1,100}$/)}),
  values:z.array(z.tuple([z.string().regex(/^\d{19}$/),z.string().max(1_048_576)])).max(10000),
})).max(1000)});

/** CLI v9 network log contract: epoch nanoseconds and JSON {_entry,type}.
 * Project only known fields; never forward the raw envelope or metadata. */
export function parseNetworkLogs(value:unknown) {
  const groups=response.parse(value);
  const rows=groups.data.flatMap(group=>group.values.map(([timestamp,json])=>{
    const row=entry.parse(JSON.parse(json));
    return {nanoseconds:BigInt(timestamp),releaseId:group.metaData.releaseId,type:row.type,message:row._entry};
  }));
  if(rows.length>10000)throw new Error('Log limit');
  return rows.sort((a,b)=>a.nanoseconds<b.nanoseconds?-1:a.nanoseconds>b.nanoseconds?1:0).map(row=>({
    datetime:new Date(Number(row.nanoseconds/1_000_000n)).toISOString(),
    type:row.type,message:row.message,releaseId:row.releaseId,
  }));
}
