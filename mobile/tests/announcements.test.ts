import test from 'node:test';
import assert from 'node:assert/strict';
import {announcementImagePath,announcementLink,visibleAnnouncements,type Announcement} from '../src/services/announcements';
test('published banners have safe links and images, distinct placements and respect Premium ad preferences',()=>{
 const origin='https://civigo.online';
 assert.equal(announcementLink('/registro',origin),origin+'/registro');
 for(const link of ['javascript:alert(1)','http://example.invalid','https://user:pass@example.invalid'])assert.equal(announcementLink(link,origin),null);
 assert.equal(announcementImagePath(1,'12345678-1234-1234-1234-123456789012'),'/announcements/1/image');assert.equal(announcementImagePath(1,'../private'),null);
 const rows=[{id:1,tipo:'NEGOCIO',ubicacion:'CABECERA'},{id:2,tipo:'NOVEDAD',ubicacion:'CABECERA'},{id:3,tipo:'NOVEDAD',ubicacion:'REPORTAR'}] as Announcement[];
 assert.deepEqual(visibleAnnouncements(rows,'CABECERA',true).map(item=>item.id),[2]);assert.deepEqual(visibleAnnouncements(rows,'REPORTAR',false).map(item=>item.id),[3]);
});
