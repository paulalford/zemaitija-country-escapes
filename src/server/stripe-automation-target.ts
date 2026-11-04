import 'server-only';
import { isIP } from 'node:net';

export const ISOLATED_DOCKER = Object.freeze({
  project: 'zemaitija-stripe-automation', service: 'stripe-automation-db',
  container: 'zemaitija-stripe-automation-db', image: 'postgres:17.6',
  network: 'zemaitija-stripe-automation-internal', volume: 'zemaitija_stripe_automation_data',
  database: 'zemaitija_stripe_automation_dev', port: 5432,
});
export type DockerEvidence = {
  container: { id:string; name:string; image:string; project:string; service:string; running:boolean;
    privileged:boolean;capAdd:string[]|null;
    configuredPorts:Record<string,{HostIp:string;HostPort:string}[]|null>;
    runtimePorts:Record<string,{HostIp:string;HostPort:string}[]|null>;
    networks:Record<string,{id:string;address:string}>;
    mounts:{type:string;name?:string;source:string;destination:string;rw:boolean}[] };
  network: {id:string;name:string;driver:string;internal:boolean;project:string;containers:string[]};
  volume: {name:string;driver:string;mountpoint:string;project:string;options:Record<string,string>|null};
};
export interface DockerEvidenceReader { read():Promise<DockerEvidence> }
export type AttestedTarget = Readonly<{ address:string; containerId:string; networkId:string; volume:string }>;
const issued = new WeakSet<object>();
const fail = ():never => { throw new Error('ISOLATED_TARGET_REJECTED'); };

/** Host-only authority. Callers must supply an independently trusted metadata reader,
 * never HTTP input, environment JSON or an application-owned Docker socket. */
export async function attestIsolatedTarget(reader:DockerEvidenceReader):Promise<AttestedTarget> {
  let e:DockerEvidence;
  try { e=await reader.read(); } catch { return fail(); }
  const t=ISOLATED_DOCKER,c=e.container,n=e.network,v=e.volume;
  const link=c.networks[t.network],data=c.mounts.filter(m=>m.destination==='/var/lib/postgresql/data');
  if(!/^[a-f0-9]{64}$/.test(c.id) || !/^[a-f0-9]{64}$/.test(n.id) ||
    c.name!==t.container || c.image!==t.image || c.project!==t.project || c.service!==t.service ||
    c.running!==true || c.privileged!==false || (c.capAdd!==null && (!Array.isArray(c.capAdd) || c.capAdd.length!==0)) ||
    JSON.stringify(c.configuredPorts)!==JSON.stringify({'5432/tcp':[{HostIp:'127.0.0.1',HostPort:'55433'}]}) ||
    JSON.stringify(c.runtimePorts)!==JSON.stringify({'5432/tcp':null}) ||
    Object.keys(c.networks).length!==1 || !link || link.id!==n.id ||
    isIP(link.address)!==4 || !/^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.)/.test(link.address) ||
    n.name!==t.network || n.driver!=='bridge' || n.internal!==true || n.project!==t.project ||
    n.containers.length!==1 || n.containers[0]!==c.id ||
    v.name!==t.volume || v.driver!=='local' || v.project!==t.project || !v.mountpoint ||
    (v.options!==null && Object.keys(v.options).length!==0) ||
    c.mounts.length!==2 || data.length!==1 || data[0].type!=='volume' || data[0].name!==t.volume ||
    data[0].source!==v.mountpoint || data[0].rw!==true ||
    !c.mounts.some(m=>m.type==='bind' && m.source==='/home/paul/Portfolio/zemaitija-country-escapes/db/init/01-roles.sh' &&
      m.destination==='/docker-entrypoint-initdb.d/01-roles.sh' && m.rw===false)) return fail();
  const proof=Object.freeze({address:link.address,containerId:c.id,networkId:n.id,volume:v.name});
  issued.add(proof);return proof;
}
export function requireAttestedTarget(proof:AttestedTarget|undefined):AttestedTarget {
  if(!proof || !issued.has(proof))return fail();
  return proof;
}
/** An IP reassignment or resource replacement requires a new reviewed run binding.
 * Re-attestation never silently changes an already prepared connection target. */
export async function refreshIsolatedTarget(proof:AttestedTarget,reader:DockerEvidenceReader):Promise<void> {
  requireAttestedTarget(proof);
  const fresh=await attestIsolatedTarget(reader);
  if(JSON.stringify(fresh)!==JSON.stringify(proof))return fail();
}
