import {useEffect,useRef,useState} from 'react';
import mermaid from 'mermaid';
let sequence=0;
export function MermaidDiagram({source}:{source:string}){
 const root=useRef<HTMLDivElement>(null);const [error,setError]=useState('');
 useEffect(()=>{let cancelled=false;setError('');if(root.current)root.current.replaceChildren();if(!source.trim())return;
  mermaid.initialize({startOnLoad:false,securityLevel:'strict',theme:'neutral'});
  mermaid.render('verbis_diagram_'+(++sequence),source).then(result=>{if(!cancelled&&root.current)root.current.innerHTML=result.svg},e=>{if(!cancelled)setError('Diagram could not render: '+e.message)});
  return()=>{cancelled=true};
 },[source]);
 return <><div ref={root} className="schema-diagram" aria-label="Database relationship diagram"/>{error&&<p role="alert">{error}</p>}</>;
}
