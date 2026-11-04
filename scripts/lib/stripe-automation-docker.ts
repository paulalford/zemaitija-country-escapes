import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { ISOLATED_DOCKER, type DockerEvidenceReader, type DockerEvidence } from '../../src/server/stripe-automation-target';

const exec=promisify(execFile);
/** Explicit host-tool adapter; importing does not contact Docker. No Config.Env is read.
 * The application/HTTP route must never import or instantiate this adapter. */
export function hostDockerReader():DockerEvidenceReader {
  return {async read(){
    const t=ISOLATED_DOCKER;
    const call=async(args:string[])=>{
      try { return JSON.parse((await exec('/usr/bin/docker',['--context','default',...args],{
        env:{PATH:'/usr/bin:/bin',HOME:'/home/paul',NODE_ENV:'test'},timeout:5000,maxBuffer:128*1024,
      })).stdout) as Record<string,unknown>; }
      catch {throw new Error('DOCKER_ATTESTATION_UNAVAILABLE');}
    };
    // Only nonsecret fields; bound by exact approved names and local Docker context.
    const endpoint=await call(['context','inspect','--format','{{json .Endpoints.docker.Host}}','default']);
    if(String(endpoint)!=='unix:///var/run/docker.sock')throw new Error('DOCKER_ATTESTATION_UNAVAILABLE');
    const c=await call(['inspect','--format','{"id":{{json .Id}},"name":{{json .Name}},"image":{{json .Config.Image}},"labels":{{json .Config.Labels}},"running":{{json .State.Running}},"privileged":{{json .HostConfig.Privileged}},"capAdd":{{json .HostConfig.CapAdd}},"configuredPorts":{{json .HostConfig.PortBindings}},"runtimePorts":{{json .NetworkSettings.Ports}},"networks":{{json .NetworkSettings.Networks}},"mounts":{{json .Mounts}}}',t.container]);
    const n=await call(['network','inspect','--format','{"id":{{json .Id}},"name":{{json .Name}},"driver":{{json .Driver}},"internal":{{json .Internal}},"labels":{{json .Labels}},"containers":{{json .Containers}}}',t.network]);
    const v=await call(['volume','inspect','--format','{"name":{{json .Name}},"driver":{{json .Driver}},"mountpoint":{{json .Mountpoint}},"options":{{json .Options}},"labels":{{json .Labels}}}',t.volume]);
    const labels=(x:Record<string,unknown>)=>x.labels as Record<string,string>;
    return {
      container:{id:c.id,name:String(c.name).replace(/^\//,''),image:c.image,project:labels(c)['com.docker.compose.project'],service:labels(c)['com.docker.compose.service'],running:c.running,privileged:c.privileged,capAdd:c.capAdd,configuredPorts:c.configuredPorts,runtimePorts:c.runtimePorts,
        networks:Object.fromEntries(Object.entries(c.networks as Record<string,{NetworkID:string;IPAddress:string}>).map(([key,x])=>[key,{id:x.NetworkID,address:x.IPAddress}])),
        mounts:(c.mounts as {Type:string;Name?:string;Source:string;Destination:string;RW:boolean}[]).map(m=>({type:m.Type,name:m.Name,source:m.Source,destination:m.Destination,rw:m.RW}))},
      network:{id:n.id,name:n.name,driver:n.driver,internal:n.internal,project:labels(n)['com.docker.compose.project'],containers:Object.keys(n.containers as object)},
      volume:{name:v.name,driver:v.driver,mountpoint:v.mountpoint,project:labels(v)['com.docker.compose.project'],options:v.options},
    } as DockerEvidence;
  }};
}
