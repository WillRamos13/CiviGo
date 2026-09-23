import CitizenSidebar from "@/components/CitizenSidebar";
import MapView from "@/components/MapView";
import RightPanel from "@/components/RightPanel";
import ChatBot from "@/components/ChatBot";


export default function Mapa(){

return(

<main className="flex min-h-screen bg-slate-950">


<CitizenSidebar />


<section className="flex-1 p-4">

<div className="h-full rounded-3xl overflow-hidden">

<MapView />

</div>

</section>


<RightPanel />


<ChatBot />


</main>

);

}