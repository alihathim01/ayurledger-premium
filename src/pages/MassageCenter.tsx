import { useEffect, useState, type ReactNode } from 'react';
import { api } from '../api';
import { useStore } from '../context/StoreContext';
import type {
  MassageClient,
  MassageService,
  MassageSession,
  MassageTherapist,
} from '../types';

type TabId = 'sessions' | 'clients' | 'services' | 'therapists' | 'report' | 'schedule';

type DailyReport = {
  sessions: MassageSession[];
  completed_count: number;
  scheduled_count: number;
  cancelled_count: number;
  no_show_count: number;
  revenue: { total: number; cash: number; card: number };
  expenses: Array<{ id: number; category: string; amount: number; description: string }>;
  total_expenses: number;
  net_profit: number;
};

type WorkingSchedule = { day_of_week: number; open_time: string; close_time: string };

const tabs: Array<{ id: TabId; label: string }> = [
  { id: 'sessions', label: 'Sessions' },
  { id: 'clients', label: 'Clients' },
  { id: 'services', label: 'Services' },
  { id: 'therapists', label: 'Therapists' },
  { id: 'report', label: 'Daily Report' },
  { id: 'schedule', label: 'Schedule' },
];

const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const today = () => new Date().toISOString().split('T')[0];

function Panel({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <section className="rounded-2xl border border-emerald-100 bg-white p-5 shadow-sm">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-stone-900">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

export function MassageCenter() {
  const { currentBranch } = useStore();
  const [activeTab, setActiveTab] = useState<TabId>('sessions');
  const branchId = currentBranch?.id ?? null;

  if (!currentBranch || currentBranch.branch_type !== 'massage_center' || !branchId) {
    return null;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 rounded-3xl bg-gradient-to-r from-emerald-900 via-emerald-800 to-lime-700 p-6 text-white shadow-lg lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.25em] text-emerald-100">Massage Outlet</p>
          <h1 className="mt-2 text-3xl font-semibold">{currentBranch.name}</h1>
          <p className="mt-2 text-sm text-emerald-100">{currentBranch.location}</p>
        </div>
        <div className="rounded-2xl border border-white/20 bg-white/10 px-4 py-3">
          <p className="text-xs uppercase tracking-wide text-emerald-100">Outlet Type</p>
          <p className="mt-1 text-sm font-medium text-white">Massage Center</p>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`rounded-xl px-4 py-2 text-sm font-medium transition ${
              activeTab === tab.id
                ? 'bg-emerald-700 text-white shadow'
                : 'bg-white text-stone-700 ring-1 ring-stone-200 hover:bg-stone-50'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'sessions' && <SessionsTab branchId={branchId} />}
      {activeTab === 'clients' && <ClientsTab />}
      {activeTab === 'services' && <ServicesTab />}
      {activeTab === 'therapists' && <TherapistsTab branchId={branchId} />}
      {activeTab === 'report' && <ReportTab branchId={branchId} />}
      {activeTab === 'schedule' && <ScheduleTab branchId={branchId} />}
    </div>
  );
}

function SessionsTab({ branchId }: { branchId: number }) {
  const [date, setDate] = useState(today());
  const [status, setStatus] = useState('');
  const [sessions, setSessions] = useState<MassageSession[]>([]);
  const [clients, setClients] = useState<MassageClient[]>([]);
  const [services, setServices] = useState<MassageService[]>([]);
  const [therapists, setTherapists] = useState<MassageTherapist[]>([]);
  const [form, setForm] = useState({
    client_id: '',
    client_name: '',
    client_mobile: '',
    therapist_id: '',
    service_id: '',
    start_time: '10:00',
    price_charged: '',
    payment_method: 'cash',
    notes: '',
    use_existing_client: false,
  });

  async function loadSessions() {
    const params = new URLSearchParams({ branchId: String(branchId), date });
    if (status) {
      params.set('status', status);
    }
    const data = await api.get<MassageSession[]>(`/api/massage/sessions?${params.toString()}`);
    setSessions(data);
  }

  useEffect(() => {
    loadSessions().catch(() => setSessions([]));
  }, [branchId, date, status]);

  useEffect(() => {
    api.get<MassageClient[]>('/api/massage/clients').then(setClients).catch(() => setClients([]));
    api.get<MassageService[]>('/api/massage/services').then(setServices).catch(() => setServices([]));
    api.get<MassageTherapist[]>(`/api/massage/therapists?branchId=${branchId}`).then(setTherapists).catch(() => setTherapists([]));
  }, [branchId]);

  async function createSession() {
    const body: Record<string, unknown> = {
      branch_id: branchId,
      booking_date: date,
      start_time: form.start_time,
      therapist_id: form.therapist_id ? Number(form.therapist_id) : undefined,
      service_id: form.service_id ? Number(form.service_id) : undefined,
      price_charged: form.price_charged ? Number(form.price_charged) : undefined,
      payment_method: form.payment_method,
      notes: form.notes || undefined,
    };

    if (form.use_existing_client && form.client_id) {
      body.client_id = Number(form.client_id);
    } else {
      body.client_name = form.client_name;
      body.client_mobile = form.client_mobile || undefined;
    }

    await api.post('/api/massage/sessions', body);
    setForm({
      client_id: '',
      client_name: '',
      client_mobile: '',
      therapist_id: '',
      service_id: '',
      start_time: '10:00',
      price_charged: '',
      payment_method: 'cash',
      notes: '',
      use_existing_client: false,
    });
    await loadSessions();
  }

  return (
    <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
      <Panel
        title="Session Queue"
        action={
          <div className="flex gap-2">
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="rounded-lg border px-3 py-2 text-sm" />
            <select value={status} onChange={(e) => setStatus(e.target.value)} className="rounded-lg border px-3 py-2 text-sm">
              <option value="">All</option>
              <option value="scheduled">Scheduled</option>
              <option value="completed">Completed</option>
              <option value="cancelled">Cancelled</option>
              <option value="no_show">No Show</option>
            </select>
          </div>
        }
      >
        <div className="space-y-3">
          {sessions.length === 0 && <p className="text-sm text-stone-500">No sessions found for this date.</p>}
          {sessions.map((session) => (
            <div key={session.id} className="rounded-2xl border border-stone-200 p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <p className="font-medium text-stone-900">{session.client_name || session.client_name_ref || 'Walk-in client'}</p>
                  <p className="mt-1 text-sm text-stone-500">
                    {session.start_time}
                    {session.end_time ? ` to ${session.end_time}` : ''}
                    {session.therapist_name ? ` | ${session.therapist_name}` : ''}
                    {session.service_name ? ` | ${session.service_name}` : ''}
                  </p>
                </div>
                <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700">
                  {session.status}
                </span>
              </div>
            </div>
          ))}
        </div>
      </Panel>

      <Panel title="Book Session">
        <div className="space-y-3">
          <div className="flex gap-2">
            <button
              onClick={() => setForm((prev) => ({ ...prev, use_existing_client: false }))}
              className={`rounded-lg px-3 py-2 text-xs font-medium ${!form.use_existing_client ? 'bg-emerald-700 text-white' : 'bg-stone-100 text-stone-600'}`}
            >
              Walk-in
            </button>
            <button
              onClick={() => setForm((prev) => ({ ...prev, use_existing_client: true }))}
              className={`rounded-lg px-3 py-2 text-xs font-medium ${form.use_existing_client ? 'bg-emerald-700 text-white' : 'bg-stone-100 text-stone-600'}`}
            >
              Existing Client
            </button>
          </div>

          {form.use_existing_client ? (
            <select value={form.client_id} onChange={(e) => setForm((prev) => ({ ...prev, client_id: e.target.value }))} className="w-full rounded-xl border px-3 py-2 text-sm">
              <option value="">Select client</option>
              {clients.map((client) => (
                <option key={client.id} value={client.id}>
                  {client.name}
                </option>
              ))}
            </select>
          ) : (
            <>
              <input value={form.client_name} onChange={(e) => setForm((prev) => ({ ...prev, client_name: e.target.value }))} placeholder="Client name" className="w-full rounded-xl border px-3 py-2 text-sm" />
              <input value={form.client_mobile} onChange={(e) => setForm((prev) => ({ ...prev, client_mobile: e.target.value }))} placeholder="Client mobile" className="w-full rounded-xl border px-3 py-2 text-sm" />
            </>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <select value={form.service_id} onChange={(e) => setForm((prev) => ({ ...prev, service_id: e.target.value }))} className="rounded-xl border px-3 py-2 text-sm">
              <option value="">Select service</option>
              {services.map((service) => (
                <option key={service.id} value={service.id}>
                  {service.name}
                </option>
              ))}
            </select>
            <select value={form.therapist_id} onChange={(e) => setForm((prev) => ({ ...prev, therapist_id: e.target.value }))} className="rounded-xl border px-3 py-2 text-sm">
              <option value="">Select therapist</option>
              {therapists.map((therapist) => (
                <option key={therapist.id} value={therapist.id}>
                  {therapist.name}
                </option>
              ))}
            </select>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <input type="time" value={form.start_time} onChange={(e) => setForm((prev) => ({ ...prev, start_time: e.target.value }))} className="rounded-xl border px-3 py-2 text-sm" />
            <input type="number" value={form.price_charged} onChange={(e) => setForm((prev) => ({ ...prev, price_charged: e.target.value }))} placeholder="Price" className="rounded-xl border px-3 py-2 text-sm" />
            <select value={form.payment_method} onChange={(e) => setForm((prev) => ({ ...prev, payment_method: e.target.value }))} className="rounded-xl border px-3 py-2 text-sm">
              <option value="cash">Cash</option>
              <option value="card">Card</option>
            </select>
          </div>

          <textarea value={form.notes} onChange={(e) => setForm((prev) => ({ ...prev, notes: e.target.value }))} placeholder="Notes" className="min-h-24 w-full rounded-xl border px-3 py-2 text-sm" />
          <button onClick={() => createSession().catch(() => undefined)} className="rounded-xl bg-emerald-700 px-4 py-2 text-sm font-medium text-white">
            Save session
          </button>
        </div>
      </Panel>
    </div>
  );
}

function ClientsTab() {
  const [clients, setClients] = useState<MassageClient[]>([]);
  const [form, setForm] = useState({ name: '', mobile: '', email: '', notes: '' });

  const load = () => api.get<MassageClient[]>('/api/massage/clients').then(setClients);

  useEffect(() => {
    load().catch(() => setClients([]));
  }, []);

  async function submit() {
    await api.post('/api/massage/clients', form);
    setForm({ name: '', mobile: '', email: '', notes: '' });
    await load();
  }

  return (
    <div className="grid gap-6 xl:grid-cols-[1fr_0.9fr]">
      <Panel title="Client Directory">
        <div className="space-y-3">
          {clients.map((client) => (
            <div key={client.id} className="rounded-2xl border border-stone-200 p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-medium text-stone-900">{client.name}</p>
                  <p className="mt-1 text-sm text-stone-500">{client.mobile || 'No mobile'} {client.email ? `| ${client.email}` : ''}</p>
                </div>
                <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700">
                  {client.visit_count} visits
                </span>
              </div>
            </div>
          ))}
        </div>
      </Panel>

      <Panel title="Add Client">
        <div className="space-y-3">
          <input value={form.name} onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))} placeholder="Name" className="w-full rounded-xl border px-3 py-2 text-sm" />
          <input value={form.mobile} onChange={(e) => setForm((prev) => ({ ...prev, mobile: e.target.value }))} placeholder="Mobile" className="w-full rounded-xl border px-3 py-2 text-sm" />
          <input value={form.email} onChange={(e) => setForm((prev) => ({ ...prev, email: e.target.value }))} placeholder="Email" className="w-full rounded-xl border px-3 py-2 text-sm" />
          <textarea value={form.notes} onChange={(e) => setForm((prev) => ({ ...prev, notes: e.target.value }))} placeholder="Notes" className="min-h-24 w-full rounded-xl border px-3 py-2 text-sm" />
          <button onClick={() => submit().catch(() => undefined)} className="rounded-xl bg-emerald-700 px-4 py-2 text-sm font-medium text-white">
            Add client
          </button>
        </div>
      </Panel>
    </div>
  );
}

function ServicesTab() {
  const [services, setServices] = useState<MassageService[]>([]);
  const [form, setForm] = useState({ name: '', duration_minutes: '60', price: '', description: '' });
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  const load = () => api.get<MassageService[]>('/api/massage/services').then(setServices);

  useEffect(() => {
    load().catch(() => setServices([]));
  }, []);

  async function submit() {
    setError('');
    setSuccess('');

    if (!form.name.trim()) {
      setError('Service name is required.');
      return;
    }

    if (!form.price || Number(form.price) < 0) {
      setError('Enter a valid price.');
      return;
    }

    setIsSaving(true);
    try {
      await api.post('/api/massage/services', {
        ...form,
        name: form.name.trim(),
        duration_minutes: Number(form.duration_minutes),
        price: Number(form.price),
      });
      setForm({ name: '', duration_minutes: '60', price: '', description: '' });
      await load();
      setSuccess('Service added.');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to add service.');
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="grid gap-6 xl:grid-cols-[1fr_0.8fr]">
      <Panel title="Service Catalog">
        <div className="grid gap-3 md:grid-cols-2">
          {services.map((service) => (
            <div key={service.id} className="rounded-2xl border border-stone-200 p-4">
              <p className="font-medium text-stone-900">{service.name}</p>
              <p className="mt-1 text-sm text-stone-500">{service.duration_minutes} minutes</p>
            </div>
          ))}
        </div>
      </Panel>

      <Panel title="Add Service">
        <div className="space-y-3">
          <input value={form.name} onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))} placeholder="Service name" className="w-full rounded-xl border px-3 py-2 text-sm" />
          <div className="grid gap-3 sm:grid-cols-2">
            <input type="number" value={form.duration_minutes} onChange={(e) => setForm((prev) => ({ ...prev, duration_minutes: e.target.value }))} placeholder="Duration" className="rounded-xl border px-3 py-2 text-sm" />
            <input type="number" value={form.price} onChange={(e) => setForm((prev) => ({ ...prev, price: e.target.value }))} placeholder="Price" className="rounded-xl border px-3 py-2 text-sm" />
          </div>
          <textarea value={form.description} onChange={(e) => setForm((prev) => ({ ...prev, description: e.target.value }))} placeholder="Description" className="min-h-24 w-full rounded-xl border px-3 py-2 text-sm" />
          {error && <p className="text-sm text-rose-700">{error}</p>}
          {success && <p className="text-sm text-emerald-700">{success}</p>}
          <button onClick={() => submit()} disabled={isSaving} className="rounded-xl bg-emerald-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-60">
            {isSaving ? 'Saving...' : 'Add service'}
          </button>
        </div>
      </Panel>
    </div>
  );
}

function TherapistsTab({ branchId }: { branchId: number }) {
  const [therapists, setTherapists] = useState<MassageTherapist[]>([]);
  const [form, setForm] = useState({ name: '', phone: '' });

  const load = () => api.get<MassageTherapist[]>(`/api/massage/therapists?branchId=${branchId}`).then(setTherapists);

  useEffect(() => {
    load().catch(() => setTherapists([]));
  }, [branchId]);

  async function submit() {
    await api.post('/api/massage/therapists', { ...form, branch_id: branchId });
    setForm({ name: '', phone: '' });
    await load();
  }

  return (
    <div className="grid gap-6 xl:grid-cols-[1fr_0.8fr]">
      <Panel title="Therapists">
        <div className="grid gap-3 md:grid-cols-2">
          {therapists.map((therapist) => (
            <div key={therapist.id} className="rounded-2xl border border-stone-200 p-4">
              <p className="font-medium text-stone-900">{therapist.name}</p>
              <p className="mt-1 text-sm text-stone-500">{therapist.phone || 'No phone'}</p>
            </div>
          ))}
        </div>
      </Panel>

      <Panel title="Add Therapist">
        <div className="space-y-3">
          <input value={form.name} onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))} placeholder="Name" className="w-full rounded-xl border px-3 py-2 text-sm" />
          <input value={form.phone} onChange={(e) => setForm((prev) => ({ ...prev, phone: e.target.value }))} placeholder="Phone" className="w-full rounded-xl border px-3 py-2 text-sm" />
          <button onClick={() => submit().catch(() => undefined)} className="rounded-xl bg-emerald-700 px-4 py-2 text-sm font-medium text-white">
            Add therapist
          </button>
        </div>
      </Panel>
    </div>
  );
}

function ReportTab({ branchId }: { branchId: number }) {
  const [date, setDate] = useState(today());
  const [report, setReport] = useState<DailyReport | null>(null);

  useEffect(() => {
    api.get<DailyReport>(`/api/massage/daily-report?branchId=${branchId}&date=${date}`).then(setReport).catch(() => setReport(null));
  }, [branchId, date]);

  if (!report) {
    return <Panel title="Daily Report"><p className="text-sm text-stone-500">No report data available.</p></Panel>;
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-end">
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="rounded-lg border px-3 py-2 text-sm" />
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Panel title="Sessions"><p className="text-3xl font-semibold text-stone-900">{report.sessions.length}</p></Panel>
        <Panel title="Revenue"><p className="text-3xl font-semibold text-stone-900">{report.revenue.total.toFixed(2)}</p></Panel>
        <Panel title="Expenses"><p className="text-3xl font-semibold text-stone-900">{report.total_expenses.toFixed(2)}</p></Panel>
        <Panel title="Net Profit"><p className={`text-3xl font-semibold ${report.net_profit >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>{report.net_profit.toFixed(2)}</p></Panel>
      </div>
    </div>
  );
}

function ScheduleTab({ branchId }: { branchId: number }) {
  const [schedule, setSchedule] = useState<WorkingSchedule[]>([]);
  const [form, setForm] = useState({ day_of_week: '0', open_time: '10:00', close_time: '02:00' });

  const load = () => api.get<{ schedule: WorkingSchedule[] }>(`/api/massage/schedule?branchId=${branchId}`).then((data) => setSchedule(data.schedule ?? []));

  useEffect(() => {
    load().catch(() => setSchedule([]));
  }, [branchId]);

  async function submit() {
    await api.post('/api/massage/schedule', {
      branch_id: branchId,
      day_of_week: Number(form.day_of_week),
      open_time: form.open_time,
      close_time: form.close_time,
    });
    await load();
  }

  return (
    <div className="grid gap-6 xl:grid-cols-[1fr_0.8fr]">
      <Panel title="Working Hours">
        <div className="space-y-3">
          {schedule.map((item) => (
            <div key={item.day_of_week} className="flex items-center justify-between rounded-2xl border border-stone-200 p-4">
              <p className="font-medium text-stone-900">{days[item.day_of_week]}</p>
              <p className="text-sm text-stone-500">{item.open_time} to {item.close_time}</p>
            </div>
          ))}
        </div>
      </Panel>

      <Panel title="Set Hours">
        <div className="space-y-3">
          <select value={form.day_of_week} onChange={(e) => setForm((prev) => ({ ...prev, day_of_week: e.target.value }))} className="w-full rounded-xl border px-3 py-2 text-sm">
            {days.map((day, index) => (
              <option key={day} value={index}>
                {day}
              </option>
            ))}
          </select>
          <div className="grid gap-3 sm:grid-cols-2">
            <input type="time" value={form.open_time} onChange={(e) => setForm((prev) => ({ ...prev, open_time: e.target.value }))} className="rounded-xl border px-3 py-2 text-sm" />
            <input type="time" value={form.close_time} onChange={(e) => setForm((prev) => ({ ...prev, close_time: e.target.value }))} className="rounded-xl border px-3 py-2 text-sm" />
          </div>
          <button onClick={() => submit().catch(() => undefined)} className="rounded-xl bg-emerald-700 px-4 py-2 text-sm font-medium text-white">
            Save schedule
          </button>
        </div>
      </Panel>
    </div>
  );
}
