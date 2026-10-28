const test=require('node:test'),assert=require('node:assert/strict');
const {normalizePlaceName}=require('../src/lib/local-places');
const {normalizeDetails,curatedDetails,createPlaceDetailsService}=require('../src/lib/place-details');
const place={nombre:'Universidad Tecnológica del Perú - Sede Ica',latitud:-14.072125,longitud:-75.735996};
test('UTP, UNICA and common abbreviations normalize to searchable full names',()=>{
 assert.equal(normalizePlaceName('UTP'),normalizePlaceName('Universidad Tecnológica del Perú'));
 assert.equal(normalizePlaceName('UNICA'),normalizePlaceName('Universidad Nacional San Luis Gonzaga'));
});
test('photo attribution and provider values survive; unsafe URLs and invented values do not',()=>{
 const data=normalizeDetails({photos:[{prefix:'https://evil.invalid/',suffix:'.jpg'},{prefix:'https://fastly.4sqi.net/img/general/',suffix:'/actual.jpg'}],rating:8.3,hours:{display:'Lun–Vie 09:00–18:00',open_now:false},website:'javascript:alert(1)',tips:[{text:'Una opinión real',user:{first_name:'Ana'},url:'https://foursquare.com/item/1'}]});
 assert.equal(data.fotos.length,1);assert.equal(data.calificacion,8.3);assert.equal(data.escala,10);assert.equal(data.abiertoAhora,false);assert.equal(data.web,null);assert.equal(data.opiniones[0].autor,'Ana');
 assert.equal(curatedDetails(place).fotos[0].autor,'Universidad Tecnológica del Perú');
 assert.equal(curatedDetails({...place,latitud:-14.3}).fotos.length,0);
});
test('details use bounded requests, refuse another nearby venue and cache a matched result',async()=>{
 let calls=0,reserved=0;
 const db={usageCounter:{upsert:async()=>{},updateMany:async()=>({count:++reserved<=1?1:0})}};
 const env={FOURSQUARE_ENABLED:'true',FOURSQUARE_SERVICE_KEY:'unit-fixture',FOURSQUARE_DAILY_REQUEST_LIMIT:'2'};
 const request=async(url,options)=>{calls++;assert.equal(options.headers.Authorization,'Bearer unit-fixture');return {ok:true,json:async()=>url.includes('/search?')?{results:[{fsq_place_id:'utp-ica',name:place.nombre,latitude:place.latitud,longitude:place.longitud},{fsq_place_id:'wrong',name:'Universidad de otra institución',latitude:place.latitud,longitude:place.longitud}]}:{latitude:place.latitud,longitude:place.longitud,rating:8.1}};};
 const service=createPlaceDetailsService({db,env,request});
 assert.equal((await service.details(place)).calificacion,8.1);assert.equal((await service.details(place)).calificacion,8.1);assert.equal(calls,2);
 const denied=await service.details({...place,nombre:'Otra universidad'});assert.equal(denied.calificacion,undefined);assert.equal(calls,2);
 const mismatch=createPlaceDetailsService({db:{usageCounter:{upsert:async()=>{},updateMany:async()=>({count:1})}},env,request:async()=>({ok:true,json:async()=>({results:[{fsq_place_id:'wrong',name:'Universidad Nacional de Ica',latitude:place.latitud,longitude:place.longitud}]})})});
 assert.equal((await mismatch.details(place)).fuente,'UTP');
});
