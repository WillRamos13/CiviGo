import test from 'node:test';
import assert from 'node:assert/strict';
import {loadTs} from './helpers/ts-module.mjs';
const {trafficFlowMessage} = loadTs('lib/traffic.ts');
const available = {configurado:true,habilitado:true,controlCuotaDisponible:true,cuotas:{tiles:{restantes:100}}};

test('traffic availability differentiates configuration, usage control, quota and provider authorization',()=>{
    assert.match(trafficFlowMessage(null),/disponibilidad/);
    assert.match(trafficFlowMessage({...available,configurado:false}),/habilitarla/);
    assert.match(trafficFlowMessage({...available,habilitado:false}),/habilitarla/);
    assert.match(trafficFlowMessage({...available,controlCuotaDisponible:false}),/límite de consultas/);
    assert.match(trafficFlowMessage({...available,cuotas:{tiles:{restantes:0}}}),/cuota/);
    assert.equal(trafficFlowMessage({...available,fallos:{tiles:{codigo:'PROVIDER_AUTHORIZATION',motivo:'La clave no autoriza tráfico.',reintentarEn:'2026-10-13T12:00:00Z'}}}),'La clave no autoriza tráfico.');
    assert.equal(trafficFlowMessage(available),'');
});
