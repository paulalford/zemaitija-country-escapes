import type { DockerEvidence } from '../../src/server/stripe-automation-target';

export function syntheticDockerEvidence():DockerEvidence {
  return {container:{id:'a'.repeat(64),name:'zemaitija-stripe-automation-db',image:'postgres:17.6',project:'zemaitija-stripe-automation',service:'stripe-automation-db',running:true,privileged:false,capAdd:null,
    configuredPorts:{'5432/tcp':[{HostIp:'127.0.0.1',HostPort:'55433'}]},runtimePorts:{'5432/tcp':null},
    networks:{'zemaitija-stripe-automation-internal':{id:'b'.repeat(64),address:'172.22.0.2'}},
    mounts:[{type:'volume',name:'zemaitija_stripe_automation_data',source:'/synthetic/volume',destination:'/var/lib/postgresql/data',rw:true},
      {type:'bind',source:'/home/paul/Portfolio/zemaitija-country-escapes/db/init/01-roles.sh',destination:'/docker-entrypoint-initdb.d/01-roles.sh',rw:false}]},
    network:{id:'b'.repeat(64),name:'zemaitija-stripe-automation-internal',driver:'bridge',internal:true,project:'zemaitija-stripe-automation',containers:['a'.repeat(64)]},
    volume:{name:'zemaitija_stripe_automation_data',driver:'local',project:'zemaitija-stripe-automation',mountpoint:'/synthetic/volume',options:null}};
}
