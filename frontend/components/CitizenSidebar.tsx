"use client";

import { useRouter, usePathname } from "next/navigation";
import {
  Map,
  FileText,
  Bell,
  User,
  ShieldAlert
} from "lucide-react";


export default function CitizenSidebar(){

const router = useRouter();
const pathname = usePathname();


const menu = [
  {
    name:"Mapa",
    icon:Map,
    route:"/mapa"
  },
  {
    name:"Reportar",
    icon:ShieldAlert,
    route:"/reportar"
  },
  {
    name:"Mis reportes",
    icon:FileText,
    route:"/mis-reportes"
  },
  {
    name:"Alertas",
    icon:Bell,
    route:"/alertas"
  },
  {
    name:"Perfil",
    icon:User,
    route:"/perfil"
  }
];


return (

<aside className="
w-64
min-h-screen
bg-slate-950
text-white
p-5
border-r
border-slate-800
flex
flex-col
justify-between
">


<div>

<h2 className="
text-sm
text-slate-400
">
Modo
</h2>


<h1 className="
text-3xl
font-bold
text-blue-400
mb-10
">
Ciudadano
</h1>



<div className="space-y-3">

{
menu.map((item)=>{

const Icon=item.icon;


const activo =
pathname === item.route;


return (

<button

key={item.name}

onClick={()=>router.push(item.route)}

className={`
w-full
flex
items-center
gap-4
p-4
rounded-xl
transition

${
activo
?
"bg-blue-500"
:
"hover:bg-slate-800"
}

`}

>

<Icon size={22}/>

<span>
{item.name}
</span>

</button>


)

})
}


</div>


</div>



<div className="
bg-slate-900
rounded-xl
p-5
text-sm
text-slate-300
">

<h3 className="
text-blue-400
font-bold
mb-2
">
CiviGo
</h3>

<p>
Juntos hacemos ciudades más seguras.
</p>


</div>


</aside>

)

}