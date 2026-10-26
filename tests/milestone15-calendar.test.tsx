import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import Calendar from '../src/app/admin/calendar/page';
import { getPresentation } from '../src/i18n/server';
import { LocaleProvider } from '../src/i18n/client';
import { presentation } from '../src/i18n/messages';
import { locales } from '../src/i18n/routing';
import { managementCalendar } from '../src/server/accommodation-management';

vi.mock('../src/i18n/server',()=>({getPresentation:vi.fn()}));
vi.mock('../src/db/client',()=>({pool:{}}));
vi.mock('../src/app/workspace/session',()=>({workspaceSession:async()=>({raw:'synthetic-session'})}));
vi.mock('../src/server/access',async importOriginal=>({
  ...await importOriginal<typeof import('../src/server/access')>(),
  mintAction:async()=>'synthetic-action',
}));
vi.mock('../src/server/accommodation-management',async importOriginal=>({
  ...await importOriginal<typeof import('../src/server/accommodation-management')>(),
  managementCalendar:vi.fn(),managementHistory:async()=>[],
}));

const unit={id:'12345678-1234-1234-1234-123456789abc',unit_key:'forest-cottage',capacity:2,enabled:true,config_version:1};
const date='2027-03-28';
const cases=locales.flatMap(locale=>(['week','month'] as const).map(view=>({locale,view})));

describe('Milestone 15 calendar filter preserves machine context',()=>{
  beforeEach(()=>{
    vi.clearAllMocks();
    vi.mocked(managementCalendar).mockResolvedValue({units:[unit],occupancy:[]});
  });
  it.each(cases)('preserves $view mode and selected date when filtering in $locale',async({locale,view})=>{
    const p=presentation(locale);
    vi.mocked(getPresentation).mockResolvedValue(p);
    const render=async(params:{date:string;view:string;unit?:string})=>renderToStaticMarkup(
      <LocaleProvider locale={locale}>{await Calendar({searchParams:Promise.resolve(params)})}</LocaleProvider>,
    );
    const html=await render({date,view});
    const form=html.match(/<form\b[^>]*class="calendar-filter"[^>]*>([\s\S]*?)<\/form>/)![0];
    expect(form).toContain('method="get"');
    expect(form).toContain(p.t('Accommodation'));
    expect(form).toContain(p.t('Apply filter'));
    expect(form).toContain(p.unitName(unit.unit_key));
    for(const label of ['Week','Month'] as const)expect(html).toContain(`>${p.t(label)}</a>`);

    // Submit the rendered hidden fields with the newly selected accommodation.
    const submitted=new URLSearchParams();
    for(const input of form.matchAll(/<input\b[^>]*name="([^"]+)"[^>]*value="([^"]*)"[^>]*>/g))submitted.set(input[1],input[2]);
    submitted.set('unit',unit.id);
    expect(submitted.get('view')).toBe(view);
    expect(submitted.get('date')).toBe(date);
    const filtered=await render({date:submitted.get('date')!,view:submitted.get('view')!,unit:submitted.get('unit')!});
    expect(filtered).toContain(`calendar-grid calendar-${view}`);
    expect(filtered).toContain(`name="date" value="${date}"`);
    expect(filtered).toContain(`<option value="${unit.id}" selected="">`);
    expect(vi.mocked(managementCalendar)).toHaveBeenLastCalledWith({},'synthetic-session',
      view==='week'?date:'2027-03-01',view==='week'?'2027-04-04':'2027-04-01',unit.id);
  });
});
