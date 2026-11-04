import { createHash } from 'node:crypto';
import { requireExecution } from './stripe-automation-connection';

export type TestOperation='fixture-setup'|'app-tests'|'fixture-retain';
export type TestPermit=Readonly<{stage:'2B-3C-1';operation:TestOperation;runId:string;humanApprovalReference:string}>;
/** An operator assertion only. Separate human approval is a procedural prerequisite. */
export function requireTestPermit(permit:TestPermit|undefined,operation:TestOperation):TestPermit {
  if(permit?.stage!=='2B-3C-1' || permit.operation!==operation)throw Error('LIVE_TEST_GATE_CLOSED');
  requireExecution({stage:'2B-3C',operation:'migrate',runId:permit.runId,humanApprovalReference:permit.humanApprovalReference},'migrate');
  return permit;
}
export function testPermit(args:string[],operation:TestOperation):TestPermit {
  if(args.length!==4 || args[0]!==`--acknowledge-stage-2b-3c-1-${operation}` || args[2]!=='--human-approval-reference')
    throw Error('LIVE_TEST_GATE_CLOSED');
  return requireTestPermit({stage:'2B-3C-1',operation,runId:args[1],humanApprovalReference:args[3]},operation);
}
/** Fixed, run-owned identities; no arbitrary SQL, UUID input, path or fixture callbacks. */
export function testFixtures(runId:string) {
  requireExecution({stage:'2B-3C',operation:'integration',runId},'integration');
  const id=(label:string)=>{
    const bytes=createHash('sha256').update(`stage-2b-3c-1:${runId}:${label}`).digest().subarray(0,16);
    bytes[6]=(bytes[6]&15)|80;bytes[8]=(bytes[8]&63)|128;
    const h=bytes.toString('hex');return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;
  };
  return Object.freeze({runId,unit:id('unit'),guest:id('guest'),schedule:id('schedule'),
    weekday:id('weekday'),weekend:id('weekend'),historyBooking:id('history-booking'),
    historyObligation:id('history-obligation'),historyAttempt:id('history-attempt'),
    key:`synthetic-automation-${runId}`});
}
