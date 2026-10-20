'use client';
import { useEffect, useRef, useState, type RefObject } from 'react';
import { lockScroll } from './scroll-lock';
export function useMapFullscreen(frame: RefObject<HTMLDivElement | null>) {
    const [active,setActive]=useState(false), [notice,setNotice]=useState('');
    const fallback=useRef(false);
    useEffect(()=>{
        const element=frame.current;
        const change=()=>{if(!fallback.current)setActive(document.fullscreenElement===element);};
        const escape=(event:KeyboardEvent)=>{if(event.key==='Escape'&&!event.defaultPrevented&&fallback.current){fallback.current=false;setActive(false);}};
        document.addEventListener('fullscreenchange',change);window.addEventListener('keydown',escape);
        return()=>{document.removeEventListener('fullscreenchange',change);window.removeEventListener('keydown',escape);if(document.fullscreenElement===element)void document.exitFullscreen().catch(()=>{});};
    },[frame]);
    useEffect(()=>{
        if(!active)return;
        return lockScroll();
    },[active]);
    const toggle=async()=>{
        const element=frame.current;if(!element)return;
        if(active){fallback.current=false;setActive(false);if(document.fullscreenElement===element)await document.exitFullscreen().catch(()=>{});setNotice('');return;}
        if(element.requestFullscreen&&document.fullscreenEnabled){
            try{await element.requestFullscreen();setActive(true);setNotice('');return;}catch{/* The fallback also supports browsers without the Fullscreen API. */}
        }
        fallback.current=true;setActive(true);setNotice('Mapa ampliado.');
    };
    return{active,toggle,notice};
}
