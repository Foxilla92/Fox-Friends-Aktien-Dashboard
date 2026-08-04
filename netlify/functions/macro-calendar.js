"use strict";

const { readJson, writeJson } = require("./github-store");
const CACHE_PATH = "shared/cache/macro-calendar.json";

function json(statusCode, body) {
  return { statusCode, headers:{"Content-Type":"application/json; charset=utf-8","Cache-Control":"public, max-age=900, s-maxage=1800"}, body:JSON.stringify(body) };
}
function ymd(date){ return date.toISOString().slice(0,10); }
function cacheFresh(cache){ return cache?.fetchedAt && Date.now()-new Date(cache.fetchedAt).getTime()<60*60*1000; }
function normalize(event){ return { id:String(event.CalendarId||event.id||""), date:event.Date||event.date, country:event.Country||event.country||"", category:event.Category||event.category||"", event:event.Event||event.event||event.Category||"", importance:Number(event.Importance||event.importance||3), source:event.Source||event.source||"" }; }
exports.handler=async function(){
  try {
    const stored=await readJson(CACHE_PATH);
    if(cacheFresh(stored.data)) return json(200,{status:"ok",events:stored.data.events||[],cached:true});
    const key=process.env.TRADING_ECONOMICS_API_KEY || "guest:guest";
    const start=new Date(); start.setUTCHours(0,0,0,0);
    const end=new Date(start); end.setUTCDate(end.getUTCDate()+3);
    const countries="united%20states,euro%20area,germany";
    const url=`https://api.tradingeconomics.com/calendar/country/${countries}/${ymd(start)}/${ymd(end)}?c=${encodeURIComponent(key)}&importance=3&f=json`;
    const response=await fetch(url);
    const data=await response.json();
    if(!response.ok || !Array.isArray(data)) throw new Error(data?.message || `Kalender-HTTP ${response.status}`);
    const events=data.map(normalize).filter(e=>e.date && e.importance>=3).sort((a,b)=>new Date(a.date)-new Date(b.date));
    const cache={fetchedAt:new Date().toISOString(),events};
    await writeJson(CACHE_PATH,cache,"Makro-Kalender aktualisieren").catch(()=>{});
    return json(200,{status:"ok",events,cached:false});
  } catch(error) {
    try { const stored=await readJson(CACHE_PATH); if(stored.data?.events) return json(200,{status:"ok",events:stored.data.events,cached:true,warning:error.message}); } catch{}
    return json(502,{status:"error",message:error.message||"Wirtschaftskalender nicht verfügbar."});
  }
};
