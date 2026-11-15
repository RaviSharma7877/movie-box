const {test}=require('node:test');
const assert=require('node:assert/strict');
const {normaliseSources}=require('../lib/mediaSources');
test('embed pages are never accepted as native video',()=>{
 assert.deepEqual(normaliseSources({sources:[{url:'https://example.com/embed/movie/1'}]}),[]);
});
test('HLS carries required headers and cannot be downloaded as MP4',()=>{
 const [source]=normaliseSources({headers:{Referer:'https://example.com/'},sources:[{url:'https://cdn.example.com/master.m3u8',quality:'auto'}]});
 assert.equal(source.type,'m3u8');assert.equal(source.downloadable,false);assert.equal(source.headers.Referer,'https://example.com/');
});
test('MP4 sources are downloadable; insecure or malformed sources are excluded',()=>{
 const sources=normaliseSources({sources:[{url:'https://cdn.example.com/video.mp4?token=123'},{url:'http://example.com/video.mp4'},{url:'https://example.com/page.html'}]});
 assert.equal(sources.length,1);assert.equal(sources[0].downloadable,true);
});
const {keepReachable}=require('../lib/mediaSources');
test('MP4 sources the CDN refuses are dropped; HLS is not probed',async()=>{
 const get=async(uri,opts)=>{assert.equal(opts.headers.Range,'bytes=0-0');return {status:uri.includes('blocked')?429:206,data:{destroy(){}}};};
 const kept=await keepReachable([{uri:'https://a/blocked.mp4',type:'mp4'},{uri:'https://a/ok.mp4',type:'mp4'},{uri:'https://a/x.m3u8',type:'m3u8'}],get);
 assert.deepEqual(kept.map(s=>s.uri),['https://a/ok.mp4','https://a/x.m3u8']);
});
const axiosForTest=require('axios');
test('film and series sources do not carry the vidlink.pro site headers to the video CDN',async()=>{
 const {directMovieSource}=require('../lib/directMovieSource');
 const original=axiosForTest.get;
 axiosForTest.get=async()=>({data:{stream:{qualities:{720:{url:'https://cdn.example/a.mp4',type:'mp4'},1080:{url:'https://cdn.example/b.mp4',type:'mp4',headers:{Referer:'https://cdn.example/'}}},captions:[]}}});
 try{
  const {sources}=await directMovieSource({id:'tt1',tmdbId:1,type:'movie'});
  assert.deepEqual(sources.find(s=>s.quality==='720p').headers,{});
  assert.deepEqual(sources.find(s=>s.quality==='1080p').headers,{Referer:'https://cdn.example/'});
 } finally { axiosForTest.get=original; }
});
