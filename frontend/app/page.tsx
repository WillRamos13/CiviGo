import CinematicHome from '@/components/home/CinematicHome';
import type {Metadata} from 'next';
export const metadata:Metadata={alternates:{canonical:'/'}};

export default function Home() {
  return <CinematicHome />;
}
