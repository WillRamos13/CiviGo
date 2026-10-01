"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),{badges}=require("../src/lib/achievements");
test("La primera insignia depende de tres reportes validados, sin confundirse con la credibilidad o las monedas",()=>{assert.equal(badges(2).filter(b=>b.obtenida).length,0);assert.deepEqual(badges(3).filter(b=>b.obtenida).map(b=>b.id),["primer-aporte"]);assert.equal(badges(25).filter(b=>b.obtenida).length,3);});
