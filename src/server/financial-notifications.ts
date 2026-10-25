import 'server-only';
import type { Pool } from 'pg';
export const financialNoticeEvents=['CANCELLED_GUEST','CANCELLED_GUEST_LATE','CANCELLED_PROVIDER','ASSESSMENT_FINALIZED','REFUND_SUCCEEDED','GUEST_PAYMENT_UPDATE','REFUND_INTERVENTION'];
export function financialNoticeContent(event:string,locale:'lt'|'en'|'de',cents:string|null,total:string|null) {
  const money=(value:string|null)=>value===null?'':`${BigInt(value)/100n}.${(BigInt(value)%100n).toString().padStart(2,'0')} EUR`;
  const messages:Record<string,Record<'lt'|'en'|'de',string>>={
    CANCELLED_GUEST:{lt:'Užsakymas atšauktas nemokamai. Visi patvirtinti mokėjimai turi būti grąžinti; grąžinimas dar nepatvirtintas.',en:'Your booking is cancelled without a cancellation charge. All verified payments are owed back; the refund is awaiting provider confirmation.',de:'Ihre Buchung ist kostenfrei storniert. Alle bestätigten Zahlungen sind zu erstatten; die Erstattung wartet auf die Anbieterbestätigung.'},
    CANCELLED_GUEST_LATE:{lt:`Užsakymas atšauktas. Mokestis bus nustatytas tik atlikus dokumentuotą nuostolių ir sumažinimo vertinimą, neviršijant ${money(total===null?null:(BigInt(total)*30n/100n).toString())}. Avansas automatiškai neprarandamas. Apie vertinimą informuosime atskirai.`,en:`Your booking is cancelled. Any charge requires documented review of loss and mitigation, capped at ${money(total===null?null:(BigInt(total)*30n/100n).toString())}. Your advance is not automatically forfeited. We will provide a separate assessment update.`,de:`Ihre Buchung ist storniert. Eine Gebühr erfordert eine dokumentierte Prüfung von Verlust und Schadensminderung, begrenzt auf ${money(total===null?null:(BigInt(total)*30n/100n).toString())}. Ihre Anzahlung verfällt nicht automatisch. Sie erhalten eine gesonderte Bewertungsmitteilung.`},
    CANCELLED_PROVIDER:{lt:'Teikėjas atšaukė užsakymą. Visi patvirtinti mokėjimai turi būti grąžinti; grąžinimas dar nepatvirtintas.',en:'The provider has cancelled your booking. All verified payments are owed back; the refund is awaiting provider confirmation.',de:'Der Anbieter hat Ihre Buchung storniert. Alle bestätigten Zahlungen sind zu erstatten; die Erstattung wartet auf die Anbieterbestätigung.'},
    ASSESSMENT_FINALIZED:{lt:`Patvirtintas atšaukimo vertinimas. Dokumentais pagrįstas mokestis: ${money(cents)}. Grąžintinos lėšos apskaitomos atskirai; grąžinimą patvirtinsime gavę teikėjo patvirtinimą.`,en:`Your cancellation assessment has been approved. The documented charge is ${money(cents)}. Any refund due remains recorded separately; we will confirm it after provider verification.`,de:`Ihre Stornierungsbewertung wurde freigegeben. Die belegte Gebühr beträgt ${money(cents)}. Eine fällige Erstattung bleibt gesondert erfasst; wir bestätigen sie nach Anbieterprüfung.`},
    REFUND_SUCCEEDED:{lt:`Mokėjimo teikėjas patvirtino ${money(cents)} grąžinimą.`,en:`The payment provider has confirmed a refund of ${money(cents)}.`,de:`Der Zahlungsanbieter hat eine Erstattung von ${money(cents)} bestätigt.`},
    GUEST_PAYMENT_UPDATE:{lt:'Jūsų mokėjimo arba grąžinimo būsena tikrinama. Grąžintinos lėšos lieka apskaitoje; grąžinimas dar nepatvirtintas. Apie rezultatą informuosime atskirai.',en:'Your payment or refund status is under review. Any refund owed remains recorded; a completed refund has not been confirmed. We will provide a separate outcome update.',de:'Ihr Zahlungs- oder Erstattungsstatus wird geprüft. Eine geschuldete Erstattung bleibt erfasst; eine abgeschlossene Erstattung wurde noch nicht bestätigt. Sie erhalten eine gesonderte Ergebnismitteilung.'},
    REFUND_INTERVENTION:{lt:'Grąžinimui reikia įgaliotų darbuotojų peržiūros. Patikrinkite teikėjo įrodymus ir neįvykdytą prievolę.',en:'Refund requires authorized operational review. Check authoritative provider evidence and the outstanding liability.',de:'Die Erstattung erfordert eine autorisierte betriebliche Prüfung. Prüfen Sie Anbieternachweise und die offene Verpflichtung.'},
  };
  if(!messages[event])throw new Error('Unknown financial notice');return messages[event][locale];
}
/** Bounded, repeatable repair of the Milestone 12 guest-update gap, including historical incidents. */
export async function backfillGuestFinancialUpdates(pool:Pool,limit=100,onlyNotificationId?:string) {
  if(!Number.isInteger(limit)||limit<1||limit>500)throw new Error('Invalid backfill limit');
  const rows=(await pool.query<{id:string}>(`SELECT n.id FROM notification_outbox n WHERE n.event_type IN ('UNALLOCATABLE_CAPTURE','PAYMENT_EVIDENCE_MISMATCH')
    AND NOT EXISTS(SELECT 1 FROM notification_outbox g WHERE g.idempotency_key='guest-money-status:'||n.idempotency_key)
    AND ($2::uuid IS NULL OR n.id=$2)
    ORDER BY EXISTS(SELECT 1 FROM audit_events a WHERE a.operation_key='guest-money-investigation:'||n.id::text),n.created_at,n.id LIMIT $1`,[limit,onlyNotificationId??null])).rows;
  for(const r of rows)await pool.query('SELECT queue_guest_money_update($1)',[r.id]);
  return rows.length;
}
